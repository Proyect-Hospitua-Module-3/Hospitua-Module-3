// Feature 011 · Revisar temporada del año
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { OverlappingSeasonCalendarError } from '../../../../../../domain/errors/pricing/overlapping-season-calendar.error';
import {
  NeighborBase,
  PublicationContext,
  SeasonCalendarDraft,
  SeasonCalendarRevision,
} from '../../../../../../domain/model/pricing/season-calendar';
import { isUuid } from '../../../../../../domain/model/pricing/season-calendar-entry';
import { SeasonCalendarReferencePort } from '../../../../../../domain/ports/out/pricing/season-calendar-reference.port';
import {
  EffectiveRevisions,
  SeasonCalendarRepositoryPort,
} from '../../../../../../domain/ports/out/pricing/season-calendar.repository.port';
import { CalendarRow, SeasonCalendarMapper } from '../../mappers/pricing/season-calendar.mapper';
import { PrismaService } from '../../prisma.service';

type Tx = Prisma.TransactionClient;

// Espacio de claves de pg_advisory_xact_lock(int, int) para el calendario: (11, año).
// No se cruza con el bloqueo de un solo número que usa el IVA de 001. La publicación lo
// toma en modo exclusivo y la lectura en modo compartido (ver findEffectiveAt).
const CALENDAR_LOCK_NAMESPACE = 11;

// Las publicaciones del mismo año y de años vecinos esperan su turno en el bloqueo:
// más margen que los 2 s / 5 s por defecto de Prisma.
const PUBLISH_TRANSACTION_OPTIONS = { maxWait: 10_000, timeout: 20_000 };

// Columnas de revisión + entrada que espera SeasonCalendarMapper.
const CALENDAR_COLUMNS = Prisma.sql`
  r.id AS revision_id, r.year, r.revision, r.effective_at, r.changed_by::text AS changed_by, r.changed_at,
  e.entry_id::text AS entry_id, e.season_id::text AS season_id, e.kind,
  to_char(e.start_date, 'YYYY-MM-DD') AS start_date, to_char(e.end_date, 'YYYY-MM-DD') AS end_date`;

// Implementa también SeasonCalendarReferencePort: 009 lo usa para no retirar una
// temporada asignada en una revisión activa (reemplaza al adaptador provisional de 009).
@Injectable()
export class PrismaSeasonCalendarRepository
  implements SeasonCalendarRepositoryPort, SeasonCalendarReferencePort
{
  constructor(private readonly prisma: PrismaService) {}

  async findEffectiveAt(years: number[], asOf: Date | null): Promise<EffectiveRevisions> {
    // La publicación fija su effective_at antes de confirmar. Sin esta espera, una
    // lectura con un asOf posterior a ese instante no vería la revisión mientras no se
    // confirme y otra lectura con el mismo asOf, un momento después, sí: 005 mezclaría
    // revisiones entre las noches de una misma consulta (contrato PORT-resolve-season-by-date,
    // "Sin mezcla de versiones"). El bloqueo compartido espera a que terminen las
    // publicaciones en curso de esos años; las lecturas no se esperan entre sí. Se toma en
    // orden ascendente, como la publicación, para no provocar interbloqueos.
    const locks = [...new Set(years)]
      .sort((a, b) => a - b)
      .map(
        (year) =>
          this.prisma
            .$executeRaw`SELECT pg_advisory_xact_lock_shared(${CALENDAR_LOCK_NAMESPACE}::int, ${year}::int)`,
      );
    // Instante, revisiones y entradas salen de una sola sentencia, ejecutada ya con los
    // bloqueos tomados (en READ COMMITTED cada sentencia ve lo confirmado hasta ese momento).
    const query = this.prisma.$queryRaw<(CalendarRow & { as_of: Date })[]>`
      WITH ref AS (SELECT COALESCE(${asOf}::timestamptz, now()) AS as_of),
      effective AS (
        SELECT DISTINCT ON (c.year) c.*
        FROM season_calendar_revision c CROSS JOIN ref
        WHERE c.year = ANY(${years}::int[]) AND c.effective_at <= ref.as_of
        ORDER BY c.year, c.revision DESC
      )
      SELECT ref.as_of, ${CALENDAR_COLUMNS}
      FROM ref
      LEFT JOIN effective r ON true
      LEFT JOIN season_calendar_entry e ON e.revision_id = r.id
      ORDER BY r.year, e.start_date, e.kind, e.entry_id`;
    const results = await this.prisma.$transaction([...locks, query]);
    const rows = results[results.length - 1] as (CalendarRow & { as_of: Date })[];
    return { asOf: rows[0].as_of, revisions: SeasonCalendarMapper.toRevisions(rows) };
  }

  async findByNumber(year: number, revision: number): Promise<SeasonCalendarRevision | null> {
    return this.loadByNumber(this.prisma, year, revision);
  }

  async publish(
    draft: SeasonCalendarDraft,
    actorId: string,
    decide: (context: PublicationContext) => void,
  ): Promise<SeasonCalendarRevision> {
    const year = draft.year.value;
    try {
      return await this.prisma.$transaction(async (tx) => {
        // 1. Serializa con las publicaciones del mismo año y de los vecinos, siempre en
        //    orden ascendente para no provocar interbloqueos (plan 011, paso 1).
        for (const lockedYear of [year - 1, year, year + 1]) {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(${CALENDAR_LOCK_NAMESPACE}::int, ${lockedYear}::int)`;
        }

        // 2. Estado para decidir, leído ya con el bloqueo tomado.
        const [active] = await tx.$queryRaw<{ revision: number }[]>`
          SELECT revision FROM season_calendar_revision WHERE year = ${year} AND is_active`;

        // FOR SHARE se serializa con el FOR UPDATE del retiro de 009: mientras dure esta
        // publicación, nadie puede retirar una temporada que usa (plan 011, paso 3).
        // Un id que no es UUID no puede existir: ni se consulta.
        const ids = draft.referencedSeasonIds().filter(isUuid);
        const seasons =
          ids.length === 0
            ? []
            : await tx.$queryRaw<{ id: string; archived: boolean }[]>`
                SELECT id::text AS id, archived_at IS NOT NULL AS archived
                FROM season WHERE id = ANY(${ids}::uuid[])
                ORDER BY id
                FOR SHARE`;

        const neighborRows = await tx.$queryRaw<
          (CalendarRow & { year: number; revision: number })[]
        >`
          SELECT ${CALENDAR_COLUMNS}
          FROM season_calendar_entry e
          JOIN season_calendar_revision r ON r.id = e.revision_id
          WHERE r.is_active AND e.kind = 'BASE' AND r.year IN (${year - 1}, ${year + 1})
          ORDER BY r.year, e.start_date`;
        const neighborBases: NeighborBase[] = neighborRows.map((row) => ({
          entry: SeasonCalendarMapper.toEntry(row),
          ownerYear: row.year,
          ownerRevision: row.revision,
        }));

        // 3. Decide el dominio; si lanza, la transacción se revierte completa.
        decide({
          activeRevision: active?.revision ?? 0,
          activeSeasonIds: new Set(seasons.filter((s) => !s.archived).map((s) => s.id)),
          neighborBases,
        });

        // 4. Nueva revisión activa. La hora es de la base de datos, truncada a
        //    milisegundos para que el effectiveAt que ve el cliente sirva tal cual como
        //    asOf (JavaScript no tiene microsegundos).
        await tx.$executeRaw`
          UPDATE season_calendar_revision SET is_active = false WHERE year = ${year} AND is_active`;
        const [saved] = await tx.$queryRaw<{ id: string; revision: number }[]>`
          INSERT INTO season_calendar_revision (year, revision, effective_at, is_active, changed_by, changed_at)
          SELECT ${year}, COALESCE(MAX(c.revision), 0) + 1, t.ts, true, ${actorId}::uuid, t.ts
          FROM (SELECT date_trunc('milliseconds', clock_timestamp()) AS ts) t
          LEFT JOIN season_calendar_revision c ON c.year = ${year}
          GROUP BY t.ts
          RETURNING id, revision`;

        if (draft.entries.length > 0) {
          const entries = draft.entries;
          await tx.$executeRaw`
            INSERT INTO season_calendar_entry (revision_id, year, entry_id, season_id, kind, start_date, end_date)
            SELECT ${saved.id}::uuid, ${year}, u.entry_id, u.season_id, u.kind, u.start_date, u.end_date
            FROM unnest(
              ${entries.map((e) => e.entryId)}::uuid[],
              ${entries.map((e) => e.seasonId)}::uuid[],
              ${entries.map((e) => e.kind)}::text[],
              ${entries.map((e) => e.range.start.toString())}::date[],
              ${entries.map((e) => e.range.end.toString())}::date[]
            ) AS u(entry_id, season_id, kind, start_date, end_date)`;
        }

        // 5. Proyección de BASE activos: sale la revisión anterior del año, entra la nueva.
        //    Si aun así hubiera un solape entre años, la restricción de exclusión lo
        //    rechaza (23P01) y se traduce abajo (plan 011, pasos 5 y 6).
        await tx.$executeRaw`DELETE FROM season_calendar_active_base WHERE year = ${year}`;
        await tx.$executeRaw`
          INSERT INTO season_calendar_active_base (calendar_entry_id, year, period)
          SELECT id, year, daterange(start_date, end_date, '[]')
          FROM season_calendar_entry
          WHERE revision_id = ${saved.id}::uuid AND kind = 'BASE'`;

        return (await this.loadByNumber(tx, year, saved.revision))!;
      }, PUBLISH_TRANSACTION_OPTIONS);
    } catch (error) {
      throw translateExclusionViolation(error);
    }
  }

  // ¿Alguna revisión ACTIVA, de cualquier año, asigna esta temporada? (puerto de 009)
  async isReferencedByActiveRevision(seasonId: string): Promise<boolean> {
    const [{ used }] = await this.prisma.$queryRaw<{ used: boolean }[]>`
      SELECT EXISTS (
        SELECT 1
        FROM season_calendar_entry e
        JOIN season_calendar_revision r ON r.id = e.revision_id
        WHERE r.is_active AND e.season_id = ${seasonId}::uuid
      ) AS used`;
    return used;
  }

  private async loadByNumber(
    client: Tx | PrismaService,
    year: number,
    revision: number,
  ): Promise<SeasonCalendarRevision | null> {
    const rows = await client.$queryRaw<CalendarRow[]>`
      SELECT ${CALENDAR_COLUMNS}
      FROM season_calendar_revision r
      LEFT JOIN season_calendar_entry e ON e.revision_id = r.id
      WHERE r.year = ${year} AND r.revision = ${revision}
      ORDER BY e.start_date, e.kind, e.entry_id`;
    return SeasonCalendarMapper.toRevisions(rows)[0] ?? null;
  }
}

// 23P01 = violación de una restricción de exclusión: aquí solo puede ser la de
// season_calendar_active_base (dos BASE activos que comparten días).
function translateExclusionViolation(error: unknown): unknown {
  const code = (error as { meta?: { code?: unknown } } | null)?.meta?.code;
  const text = error instanceof Error ? error.message : String(error);
  if (code === '23P01' || text.includes('23P01')) {
    return new OverlappingSeasonCalendarError(
      'otra publicación activó entretanto un período que comparte días con esta revisión. ' +
        'Consulta el calendario vigente y vuelve a intentarlo.',
    );
  }
  return error;
}
