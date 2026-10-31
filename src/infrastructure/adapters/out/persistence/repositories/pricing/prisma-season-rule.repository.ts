// Feature 009 · Modificar precio tarifa según temporada
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { SeasonNameConflictError } from '../../../../../../domain/errors/pricing/season-name-conflict.error';
import { SeasonNotFoundError } from '../../../../../../domain/errors/pricing/season-not-found.error';
import { Season, SeasonChanges } from '../../../../../../domain/model/pricing/season';
import { SeasonCatalog } from '../../../../../../domain/ports/in/pricing/modify-season-rule.use-case';
import {
  NewSeason,
  SeasonRuleRepositoryPort,
  SeasonRuleSnapshot,
} from '../../../../../../domain/ports/out/pricing/season-rule.repository.port';
import { SeasonMapper, SeasonRow, SeasonSnapshotRow } from '../../mappers/pricing/season.mapper';
import { PrismaService } from '../../prisma.service';

type Tx = Prisma.TransactionClient;

// Expresión del índice único parcial season_active_name_key de la migración: nombre
// normalizado entre temporadas no retiradas.
const ACTIVE_NAME_KEY_EXPRESSION = 'lower(btrim(name))';

// Todas las horas salen de la base de datos con clock_timestamp() y se copian en SQL
// entre tablas: pasarlas por JavaScript perdería los microsegundos (igual que en 001).
@Injectable()
export class PrismaSeasonRuleRepository implements SeasonRuleRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async listActive(): Promise<SeasonCatalog> {
    // Una sola sentencia: catálogo y hora de lectura consistentes entre sí.
    const rows = await this.prisma.$queryRaw<(SeasonRow & { as_of: Date })[]>`
      SELECT s.id, s.name, s.color, s.is_default, s.version, s.updated_by, s.updated_at,
             r.id AS rule_id, r.adjustment_percent, r.valid_from, now() AS as_of
      FROM season s
      JOIN season_rule r ON r.season_id = s.id AND r.valid_to IS NULL
      WHERE s.archived_at IS NULL
      ORDER BY lower(btrim(s.name)), s.id`;
    return {
      asOf: rows[0]?.as_of ?? new Date(),
      seasons: rows.map((row) => SeasonMapper.toDomain(row)),
    };
  }

  async create(season: NewSeason, actorId: string): Promise<Season> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const [{ id }] = await tx.$queryRaw<{ id: string }[]>`
          INSERT INTO season (name, color, is_default, version, created_at, created_by, updated_at, updated_by)
          SELECT ${season.name.value}, ${season.color.value}, false, 1, t.ts, ${actorId}::uuid, t.ts, ${actorId}::uuid
          FROM (SELECT clock_timestamp() AS ts) t
          RETURNING id`;

        const [{ rule_id }] = await tx.$queryRaw<{ rule_id: string }[]>`
          INSERT INTO season_rule (season_id, adjustment_percent, valid_from, created_at, created_by)
          SELECT id, ${season.adjustmentPercent.toString()}::numeric, created_at, created_at, created_by
          FROM season WHERE id = ${id}::uuid
          RETURNING id AS rule_id`;

        await tx.$executeRaw`
          INSERT INTO season_rule_history
            (season_id, change_type, new_rule_id, new_adjustment, new_name, new_color, changed_by, changed_at)
          SELECT s.id, 'CREATE', r.id, r.adjustment_percent, s.name, s.color, s.created_by, s.created_at
          FROM season s JOIN season_rule r ON r.id = ${rule_id}::uuid
          WHERE s.id = ${id}::uuid`;

        return this.loadCurrent(tx, id);
      });
    } catch (error) {
      throw this.translateNameConflict(error, season.name.value);
    }
  }

  async modify(
    seasonId: string,
    actorId: string,
    decide: (current: Season) => SeasonChanges | null,
  ): Promise<Season> {
    let requestedName: string | undefined;
    try {
      return await this.prisma.$transaction(async (tx) => {
        const locked = await this.lockActive(tx, seasonId);
        const current = SeasonMapper.toDomain(locked);

        // El dominio decide con el estado bloqueado; si lanza, la transacción se revierte.
        const changes = decide(current);
        if (!changes) {
          return current; // No-op: sin versión nueva ni historial (casos límite de la spec).
        }
        requestedName = changes.name?.value;

        await tx.$executeRaw`
          UPDATE season
          SET name = COALESCE(${changes.name?.value ?? null}::text, name),
              color = COALESCE(${changes.color?.value ?? null}::text, color),
              version = version + 1,
              updated_at = clock_timestamp(),
              updated_by = ${actorId}::uuid
          WHERE id = ${seasonId}::uuid`;

        let newRuleId: string | null = null;
        if (changes.adjustmentPercent) {
          // La versión anterior se cierra y la nueva empieza en el mismo instante exacto:
          // nunca hay un hueco ni un solapamiento entre versiones (FR-003).
          await tx.$executeRaw`
            UPDATE season_rule r SET valid_to = s.updated_at
            FROM season s
            WHERE r.id = ${locked.rule_id}::uuid AND s.id = r.season_id`;
          [{ rule_id: newRuleId }] = await tx.$queryRaw<{ rule_id: string }[]>`
            INSERT INTO season_rule (season_id, adjustment_percent, valid_from, created_at, created_by)
            SELECT id, ${changes.adjustmentPercent.toString()}::numeric, updated_at, updated_at, updated_by
            FROM season WHERE id = ${seasonId}::uuid
            RETURNING id AS rule_id`;
        }

        // Auditoría en la misma transacción: si falla, tampoco cambia la temporada (FR-004).
        await tx.$executeRaw`
          INSERT INTO season_rule_history
            (season_id, change_type, previous_rule_id, new_rule_id, previous_adjustment, new_adjustment,
             previous_name, new_name, previous_color, new_color, changed_by, changed_at)
          SELECT s.id, 'UPDATE',
                 ${newRuleId ? locked.rule_id : null}::uuid, ${newRuleId}::uuid,
                 ${newRuleId ? locked.adjustment_percent.toFixed(2) : null}::numeric,
                 ${changes.adjustmentPercent?.toString() ?? null}::numeric,
                 ${changes.name ? locked.name : null}::text, ${changes.name?.value ?? null}::text,
                 ${changes.color ? locked.color : null}::text, ${changes.color?.value ?? null}::text,
                 s.updated_by, s.updated_at
          FROM season s WHERE s.id = ${seasonId}::uuid`;

        return this.loadCurrent(tx, seasonId);
      });
    } catch (error) {
      throw this.translateNameConflict(error, requestedName ?? '');
    }
  }

  async retire(
    seasonId: string,
    actorId: string,
    authorize: (current: Season) => Promise<void>,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const locked = await this.lockActive(tx, seasonId);
      await authorize(SeasonMapper.toDomain(locked));

      // Retiro lógico: la fila, sus reglas y su historial se conservan (FR-001, FR-004).
      await tx.$executeRaw`
        UPDATE season SET archived_at = clock_timestamp(), archived_by = ${actorId}::uuid
        WHERE id = ${seasonId}::uuid`;
      await tx.$executeRaw`
        UPDATE season_rule r SET valid_to = s.archived_at
        FROM season s
        WHERE r.id = ${locked.rule_id}::uuid AND s.id = r.season_id`;
      await tx.$executeRaw`
        INSERT INTO season_rule_history
          (season_id, change_type, previous_rule_id, previous_adjustment, previous_name, previous_color,
           changed_by, changed_at)
        SELECT s.id, 'RETIRE', ${locked.rule_id}::uuid, ${locked.adjustment_percent.toFixed(2)}::numeric,
               s.name, s.color, s.archived_by, s.archived_at
        FROM season s WHERE s.id = ${seasonId}::uuid`;
    });
  }

  async findEffectiveAt(asOf: Date): Promise<SeasonRuleSnapshot[]> {
    // Por temporada, la regla que empezó más recientemente antes de asOf: para una
    // temporada activa es la vigente; para una retirada, la última que tuvo.
    // Las temporadas creadas después de asOf no tienen regla y quedan fuera.
    const rows = await this.prisma.$queryRaw<SeasonSnapshotRow[]>`
      SELECT s.id, s.name, s.color, s.is_default,
             CASE WHEN s.archived_at <= ${asOf}::timestamptz THEN s.archived_at END AS archived_at,
             r.adjustment_percent, r.valid_from
      FROM season s
      JOIN LATERAL (
        SELECT adjustment_percent, valid_from
        FROM season_rule
        WHERE season_id = s.id AND valid_from <= ${asOf}::timestamptz
        ORDER BY valid_from DESC
        LIMIT 1
      ) r ON true
      ORDER BY lower(btrim(s.name)), s.id`;
    return rows.map((row) => SeasonMapper.toSnapshot(row));
  }

  // SELECT … FOR UPDATE: serializa los cambios de una misma temporada (plan 009).
  //
  // Se bloquea la temporada SOLA y la regla vigente se lee DESPUÉS, en otra sentencia.
  // Si se bloqueara con un JOIN a season_rule, quien espera el bloqueo recibiría la fila
  // de season actualizada pero la regla de su lectura original, ya cerrada por quien
  // terminó primero: cerraría otra vez esa regla y solaparía versiones. En READ COMMITTED
  // cada sentencia nueva ve lo último confirmado, así que la lectura posterior es segura.
  private async lockActive(tx: Tx, seasonId: string): Promise<SeasonRow> {
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM season
      WHERE id = ${seasonId}::uuid AND archived_at IS NULL
      FOR UPDATE`;
    if (locked.length === 0) {
      throw new SeasonNotFoundError(seasonId);
    }
    return this.loadCurrentRow(tx, seasonId);
  }

  private async loadCurrent(tx: Tx, seasonId: string): Promise<Season> {
    return SeasonMapper.toDomain(await this.loadCurrentRow(tx, seasonId));
  }

  private async loadCurrentRow(tx: Tx, seasonId: string): Promise<SeasonRow> {
    const [row] = await tx.$queryRaw<SeasonRow[]>`
      SELECT s.id, s.name, s.color, s.is_default, s.version, s.updated_by, s.updated_at,
             r.id AS rule_id, r.adjustment_percent, r.valid_from
      FROM season s
      JOIN season_rule r ON r.season_id = s.id AND r.valid_to IS NULL
      WHERE s.id = ${seasonId}::uuid`;
    return row;
  }

  // El índice único es la garantía real ante dos altas simultáneas con el mismo nombre.
  // PostgreSQL no incluye el nombre del índice en el mensaje, pero sí la expresión indexada.
  private translateNameConflict(error: unknown, name: string): unknown {
    const text = error instanceof Error ? error.message : String(error);
    const isNameConflict = text.includes('23505') && text.includes(ACTIVE_NAME_KEY_EXPRESSION);
    return isNameConflict ? new SeasonNameConflictError(name) : error;
  }
}
