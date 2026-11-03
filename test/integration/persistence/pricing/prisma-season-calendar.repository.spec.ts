// Feature 011 · Revisar temporada del año
// Repositorio real contra PostgreSQL (T015, T021, T030, T031, T038, T040), junto con el
// catálogo real de 009. Necesita una base ya migrada en TEST_DATABASE_URL; sin esa
// variable estas pruebas se omiten.
// ¡Borra y recrea el calendario y el catálogo de temporadas de esa base!
import { randomUUID } from 'crypto';
import { GetEffectiveSeasonRulesService } from '../../../../src/application/services/pricing/get-effective-season-rules.service';
import { ModifySeasonRuleService } from '../../../../src/application/services/pricing/modify-season-rule.service';
import { ReplaceSeasonCalendarService } from '../../../../src/application/services/pricing/replace-season-calendar.service';
import { ResolveSeasonByDateService } from '../../../../src/application/services/pricing/resolve-season-by-date.service';
import { ReviewSeasonCalendarService } from '../../../../src/application/services/pricing/review-season-calendar.service';
import { OverlappingSeasonCalendarError } from '../../../../src/domain/errors/pricing/overlapping-season-calendar.error';
import { SeasonCalendarConflictError } from '../../../../src/domain/errors/pricing/season-calendar-conflict.error';
import { SeasonCalendarInconsistentError } from '../../../../src/domain/errors/pricing/season-calendar-inconsistent.error';
import { SeasonInUseError } from '../../../../src/domain/errors/pricing/season-in-use.error';
import { UnknownSeasonReferenceError } from '../../../../src/domain/errors/pricing/unknown-season-reference.error';
import { SeasonAdjustmentPercent } from '../../../../src/domain/model/pricing/season-adjustment-percent.vo';
import { SeasonCalendarDraft } from '../../../../src/domain/model/pricing/season-calendar';
import { SeasonColor } from '../../../../src/domain/model/pricing/season-color.vo';
import { SeasonName } from '../../../../src/domain/model/pricing/season-name.vo';
import { SeasonRulesCatalogAdapter } from '../../../../src/infrastructure/adapters/out/catalog/season-rules-catalog.adapter';
import { PrismaService } from '../../../../src/infrastructure/adapters/out/persistence/prisma.service';
import { PrismaSeasonCalendarRepository } from '../../../../src/infrastructure/adapters/out/persistence/repositories/pricing/prisma-season-calendar.repository';
import { PrismaSeasonRuleRepository } from '../../../../src/infrastructure/adapters/out/persistence/repositories/pricing/prisma-season-rule.repository';
import {
  lockPricingTestDatabase,
  PRICING_TEST_LOCK_TIMEOUT_MS,
} from '../../../support/database/pricing-test-database-lock';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeWithDatabase = TEST_DATABASE_URL ? describe : describe.skip;

const ADMIN = 'f2d3b4a5-6c7d-4e8f-9012-3456789abcde';
const REGULAR_ID = '00000000-0000-4000-8000-000000000001';
// Las publicaciones simultáneas esperan su turno en el bloqueo (hasta 10 s en Prisma).
const CONCURRENCY_TIMEOUT_MS = 30_000;

type RawEntry = {
  seasonId: string;
  kind: string;
  startDate: string;
  endDate: string;
  entryId?: string;
};

describeWithDatabase('PrismaSeasonCalendarRepository (PostgreSQL real)', () => {
  let prisma: PrismaService;
  let calendars: PrismaSeasonCalendarRepository;
  let seasonRules: PrismaSeasonRuleRepository;
  let review: ReviewSeasonCalendarService;
  let replace: ReplaceSeasonCalendarService;
  let resolve: ResolveSeasonByDateService;
  let modifySeasons: ModifySeasonRuleService;
  let unlockDatabase: () => Promise<void>;
  let altaId: string;
  let eventoId: string;

  beforeAll(async () => {
    // La suite de 009 borra las mismas tablas: se turnan.
    unlockDatabase = await lockPricingTestDatabase(TEST_DATABASE_URL!);
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    prisma = new PrismaService();
    await prisma.$connect();
    calendars = new PrismaSeasonCalendarRepository(prisma);
    seasonRules = new PrismaSeasonRuleRepository(prisma);
    const catalog = new SeasonRulesCatalogAdapter(new GetEffectiveSeasonRulesService(seasonRules));
    review = new ReviewSeasonCalendarService(calendars, catalog);
    replace = new ReplaceSeasonCalendarService(calendars, review);
    resolve = new ResolveSeasonByDateService(calendars, catalog);
    modifySeasons = new ModifySeasonRuleService(seasonRules, calendars);
  }, PRICING_TEST_LOCK_TIMEOUT_MS);

  // Calendario vacío y catálogo con Regular, Alta y Evento.
  beforeEach(async () => {
    await prisma.$executeRaw`DELETE FROM season_calendar_active_base`;
    await prisma.$executeRaw`DELETE FROM season_calendar_entry`;
    await prisma.$executeRaw`DELETE FROM season_calendar_revision`;
    await prisma.$executeRaw`DELETE FROM season_rule_history`;
    await prisma.$executeRaw`DELETE FROM season_rule`;
    await prisma.$executeRaw`DELETE FROM season`;
    await prisma.$executeRaw`
      INSERT INTO season (id, name, color, is_default, version, created_at, created_by, updated_at, updated_by)
      SELECT ${REGULAR_ID}::uuid, 'Regular', '#808080', true, 1, t.ts, ${ADMIN}::uuid, t.ts, ${ADMIN}::uuid
      FROM (SELECT clock_timestamp() AS ts) t`;
    await prisma.$executeRaw`
      INSERT INTO season_rule (season_id, adjustment_percent, valid_from, created_at, created_by)
      SELECT id, 0, created_at, created_at, created_by FROM season`;
    altaId = (await seasonRules.create(newSeason('Temporada alta', '25'), ADMIN)).id;
    eventoId = (await seasonRules.create(newSeason('Evento especial', '50'), ADMIN)).id;
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    await unlockDatabase?.();
  });

  function newSeason(name: string, adjustment: string) {
    return {
      name: SeasonName.of(name),
      color: SeasonColor.of('#E67E22'),
      adjustmentPercent: SeasonAdjustmentPercent.of(adjustment),
    };
  }

  const base = (seasonId: string, startDate: string, endDate: string): RawEntry => ({
    seasonId,
    kind: 'BASE',
    startDate,
    endDate,
  });
  const exception = (seasonId: string, date: string): RawEntry => ({
    seasonId,
    kind: 'EXCEPTION',
    startDate: date,
    endDate: date,
  });

  function publish(year: number, entries: RawEntry[], expectedRevision?: number | null) {
    return replace.replace({ year, entries, expectedRevision, actorId: ADMIN });
  }

  function draft(year: number, entries: RawEntry[]) {
    return SeasonCalendarDraft.parse({ year, entries }, randomUUID);
  }

  // Inserta una revisión saltándose el repositorio (y su proyección de BASE activos),
  // para simular datos heredados corruptos o probar las restricciones de la base.
  async function insertRawRevision(
    year: number,
    revision: number,
    active: boolean,
    entries: RawEntry[],
  ) {
    const [{ id }] = await prisma.$queryRaw<{ id: string }[]>`
      INSERT INTO season_calendar_revision (year, revision, effective_at, is_active, changed_by, changed_at)
      VALUES (${year}, ${revision}, clock_timestamp(), ${active}, ${ADMIN}::uuid, clock_timestamp())
      RETURNING id::text`;
    for (const e of entries) {
      await prisma.$executeRaw`
        INSERT INTO season_calendar_entry (revision_id, year, entry_id, season_id, kind, start_date, end_date)
        VALUES (${id}::uuid, ${year}, ${randomUUID()}::uuid, ${e.seasonId}::uuid, ${e.kind},
                ${e.startDate}::date, ${e.endDate}::date)`;
    }
    return id;
  }

  async function revisionsOf(year: number) {
    return prisma.$queryRaw<{ revision: number; is_active: boolean }[]>`
      SELECT revision, is_active FROM season_calendar_revision WHERE year = ${year} ORDER BY revision`;
  }

  async function overlappingActiveBases(): Promise<number> {
    const [{ count }] = await prisma.$queryRaw<{ count: number }[]>`
      SELECT count(*)::int AS count
      FROM season_calendar_active_base a
      JOIN season_calendar_active_base b
        ON a.calendar_entry_id < b.calendar_entry_id AND a.period && b.period`;
    return count;
  }

  // Hora de la base de datos, posterior a todo lo ya confirmado. No se usa new Date():
  // Postgres en Docker corre en otra máquina (virtual) y su reloj puede no coincidir.
  // La espera evita que una publicación posterior caiga en el mismo milisegundo.
  async function dbNow(): Promise<Date> {
    const [{ now }] = await prisma.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`;
    await new Promise((r) => setTimeout(r, 5));
    return now;
  }

  // Lo que hay en la proyección de BASE activos (daterange como texto).
  async function activeBases() {
    return prisma.$queryRaw<{ calendar_entry_id: string; year: number; period: string }[]>`
      SELECT calendar_entry_id::text, year, period::text
      FROM season_calendar_active_base ORDER BY calendar_entry_id`;
  }

  describe('publicación y lectura', () => {
    it('publica la revisión con hora de la base de datos y la deja como única activa', async () => {
      await publish(2026, [base(altaId, '2026-06-01', '2026-08-31')]);
      const second = await publish(2026, [exception(eventoId, '2026-07-04')], 1);

      expect(await revisionsOf(2026)).toEqual([
        { revision: 1, is_active: false },
        { revision: 2, is_active: true },
      ]);
      expect(second.changedBy).toBe(ADMIN);
      expect(second.effectiveAt).toEqual(second.changedAt);
    });

    it('el effectiveAt devuelto sirve tal cual como asOf (truncado a milisegundos)', async () => {
      const published = await calendars.publish(
        draft(2026, [base(altaId, '2026-06-01', '2026-08-31')]),
        ADMIN,
        () => {},
      );

      const found = await calendars.findEffectiveAt([2026], published.effectiveAt);
      expect(found.revisions.map((r) => r.revision)).toEqual([published.revision]);
      const justBefore = new Date(published.effectiveAt.getTime() - 1);
      expect((await calendars.findEffectiveAt([2026], justBefore)).revisions).toEqual([]);
    });

    it('lee la revisión completa con todas sus entradas y la del año anterior en la misma consulta (T015)', async () => {
      await publish(2025, [base(altaId, '2025-12-20', '2026-01-10')]);
      await publish(2026, [
        base(altaId, '2026-06-01', '2026-08-31'),
        exception(eventoId, '2026-07-04'),
        base(eventoId, '2026-12-01', '2026-12-31'),
      ]);

      const view = await review.review({ year: '2026' });

      expect(view.revision).toBe(1);
      expect(view.entries).toHaveLength(3);
      expect(view.carriedInEntries).toEqual([
        expect.objectContaining({
          ownerYear: 2025,
          ownerRevision: 1,
          startDate: '2025-12-20',
          endDate: '2026-01-10',
        }),
      ]);
      expect(view.entries[0].season).toEqual(
        expect.objectContaining({
          seasonId: altaId,
          name: 'Temporada alta',
          adjustmentPercent: '25.00',
        }),
      );
      expect(view.conflicts).toEqual([]);
    });

    it('reporta como bloqueantes las filas heredadas que se solapan y la resolución falla en vez de elegir (T015)', async () => {
      await publish(2025, [base(altaId, '2025-12-20', '2026-01-10')]);
      // Datos corruptos: un BASE de 2026 que comparte días con el heredado de 2025.
      await insertRawRevision(2026, 1, true, [base(eventoId, '2026-01-05', '2026-01-31')]);

      const view = await review.review({ year: '2026' });

      expect(view.conflicts).toEqual([
        expect.objectContaining({
          code: 'OVERLAPPING_SEASON_CALENDAR',
          blocking: true,
          dates: { from: '2026-01-05', to: '2026-01-10' },
        }),
      ]);
      expect(view.conflicts[0].entryIds).toHaveLength(2);
      await expect(resolve.resolve({ date: '2026-01-07', asOf: await dbNow() })).rejects.toThrow(
        SeasonCalendarInconsistentError,
      );
    });

    it('una resolución con un asOf anterior a una publicación no ve la revisión nueva', async () => {
      await publish(2026, [base(altaId, '2026-06-01', '2026-08-31')]);
      const asOf = await dbNow();
      await publish(2026, [base(eventoId, '2026-06-01', '2026-08-31')]);

      const old = await resolve.resolve({ date: '2026-07-01', asOf });
      const current = await resolve.resolve({ date: '2026-07-01', asOf: await dbNow() });

      expect(old).toMatchObject({ seasonId: altaId, revision: 1, source: 'BASE' });
      expect(current).toMatchObject({ seasonId: eventoId, revision: 2, source: 'BASE' });
    });
  });

  describe('concurrencia', () => {
    it(
      'una lectura con un asOf posterior a una publicación sin confirmar la espera y la ve: el mismo asOf siempre da lo mismo',
      async () => {
        // Publicación en curso, igual que publish: bloqueo exclusivo del año y revisión ya
        // insertada con su effective_at, pero todavía sin confirmar.
        let commit!: () => void;
        const released = new Promise<void>((r) => (commit = r));
        let markInserted!: () => void;
        const inserted = new Promise<void>((r) => (markInserted = r));
        const publication = prisma.$transaction(
          async (tx) => {
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(11, 2026)`;
            const [{ id }] = await tx.$queryRaw<{ id: string }[]>`
            INSERT INTO season_calendar_revision (year, revision, effective_at, is_active, changed_by, changed_at)
            SELECT 2026, 1, t.ts, true, ${ADMIN}::uuid, t.ts
            FROM (SELECT date_trunc('milliseconds', clock_timestamp()) AS ts) t
            RETURNING id::text`;
            await tx.$executeRaw`
            INSERT INTO season_calendar_entry (revision_id, year, entry_id, season_id, kind, start_date, end_date)
            VALUES (${id}::uuid, 2026, ${randomUUID()}::uuid, ${eventoId}::uuid, 'EXCEPTION', '2026-07-04', '2026-07-04')`;
            markInserted();
            await released;
          },
          { timeout: CONCURRENCY_TIMEOUT_MS },
        );

        try {
          await inserted;
          const asOf = await dbNow(); // posterior al effective_at de la publicación en curso
          let settled = false;
          const reading = resolve.resolve({ date: '2026-07-04', asOf });
          reading.then(
            () => (settled = true),
            () => (settled = true),
          );
          await new Promise((r) => setTimeout(r, 300));
          expect(settled).toBe(false); // espera a que la publicación termine

          commit();
          await publication;
          await expect(reading).resolves.toMatchObject({
            seasonId: eventoId,
            source: 'EXCEPTION',
            revision: 1,
          });
          await expect(resolve.resolve({ date: '2026-07-04', asOf })).resolves.toMatchObject({
            seasonId: eventoId,
            revision: 1,
          });
        } finally {
          commit();
          await publication.catch(() => undefined);
        }
      },
      CONCURRENCY_TIMEOUT_MS,
    );

    it(
      'lecturas simultáneas a publicaciones ven revisiones completas de ambos años, sin mezclar (T021)',
      async () => {
        // La revisión k de cada año tiene exactamente k excepciones: si una lectura mezclara
        // entradas de dos revisiones, el conteo no coincidiría con el número.
        const exceptionsFor = (year: number, k: number) =>
          Array.from({ length: k }, (_, i) =>
            exception(eventoId, `${year}-03-${String(i + 1).padStart(2, '0')}`),
          );
        let publishing = true;
        const writer = (async () => {
          try {
            for (let k = 1; k <= 8; k++) {
              await publish(2025, exceptionsFor(2025, k));
              await publish(2026, exceptionsFor(2026, k));
            }
          } finally {
            // Si una publicación falla, los lectores también paran.
            publishing = false;
          }
        })();

        const seen: number[] = [];
        const readers = Array.from({ length: 4 }, async () => {
          while (publishing) {
            const { revisions } = await calendars.findEffectiveAt([2025, 2026], null);
            for (const revision of revisions) {
              expect(revision.entries).toHaveLength(revision.revision);
              seen.push(revision.revision);
            }
          }
        });
        await Promise.all([writer, ...readers]);

        expect(seen.length).toBeGreaterThan(0);
      },
      CONCURRENCY_TIMEOUT_MS,
    );

    it(
      'con la misma expectedRevision, solo una de varias publicaciones simultáneas gana (T030)',
      async () => {
        const results = await Promise.allSettled(
          Array.from({ length: 5 }, (_, i) =>
            publish(2026, [exception(eventoId, `2026-07-0${i + 1}`)], null),
          ),
        );

        expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
        for (const r of results.filter(
          (r): r is PromiseRejectedResult => r.status === 'rejected',
        )) {
          expect(r.reason).toBeInstanceOf(SeasonCalendarConflictError);
        }
        expect(await revisionsOf(2026)).toEqual([{ revision: 1, is_active: true }]);
      },
      CONCURRENCY_TIMEOUT_MS,
    );

    it(
      'publicaciones simultáneas de años vecinos con BASE incompatibles: solo una se activa (T030)',
      async () => {
        const results = await Promise.allSettled([
          publish(2026, [base(altaId, '2026-12-20', '2027-01-10')]),
          publish(2027, [base(eventoId, '2027-01-05', '2027-01-20')]),
        ]);

        expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
        const [rejected] = results.filter(
          (r): r is PromiseRejectedResult => r.status === 'rejected',
        );
        expect(rejected.reason).toBeInstanceOf(OverlappingSeasonCalendarError);
        expect(await overlappingActiveBases()).toBe(0);
      },
      CONCURRENCY_TIMEOUT_MS,
    );

    it(
      'publicar con una temporada mientras 009 la retira: nunca terminan las dos (T030, T016 de 009)',
      async () => {
        const [published, retired] = await Promise.allSettled([
          publish(2026, [exception(eventoId, '2026-07-04')]),
          modifySeasons.retire({ seasonId: eventoId, actorId: ADMIN }),
        ]);

        if (published.status === 'fulfilled') {
          expect(retired).toMatchObject({
            status: 'rejected',
            reason: expect.any(SeasonInUseError),
          });
        } else {
          expect(published.reason).toBeInstanceOf(UnknownSeasonReferenceError);
          expect(retired.status).toBe('fulfilled');
        }
        const [{ broken }] = await prisma.$queryRaw<{ broken: boolean }[]>`
        SELECT EXISTS (
          SELECT 1 FROM season_calendar_entry e
          JOIN season_calendar_revision r ON r.id = e.revision_id
          JOIN season s ON s.id = e.season_id
          WHERE r.is_active AND s.archived_at IS NOT NULL
        ) AS broken`;
        expect(broken).toBe(false);
      },
      CONCURRENCY_TIMEOUT_MS,
    );
  });

  describe('atomicidad (T031)', () => {
    it('si falla una entrada al guardarse, la revisión activa anterior sigue intacta', async () => {
      await publish(2026, [base(altaId, '2026-06-01', '2026-08-31')]);
      const before = await activeBases();

      // Sin la decisión del dominio, una temporada inexistente llega hasta el INSERT y la
      // FK lo rechaza después de haber desactivado la revisión anterior.
      const unknownSeason = randomUUID();
      await expect(
        calendars.publish(
          draft(2026, [
            base(altaId, '2026-03-01', '2026-03-31'),
            exception(unknownSeason, '2026-07-04'),
          ]),
          ADMIN,
          () => {},
        ),
      ).rejects.toThrow();

      expect(await revisionsOf(2026)).toEqual([{ revision: 1, is_active: true }]);
      expect(before).toHaveLength(1);
      expect(await activeBases()).toEqual(before);
    });

    it('si el dominio rechaza, no se escribe nada', async () => {
      await expect(
        publish(2026, [
          base(altaId, '2026-06-01', '2026-08-31'),
          base(eventoId, '2026-08-01', '2026-09-30'),
        ]),
      ).rejects.toThrow(OverlappingSeasonCalendarError);

      expect(await revisionsOf(2026)).toEqual([]);
    });
  });

  describe('solapes BASE entre años vecinos (T040)', () => {
    it('rechaza publicar el año siguiente con un BASE que pisa el heredado', async () => {
      await publish(2026, [base(altaId, '2026-12-20', '2027-01-10')]);

      await expect(publish(2027, [base(eventoId, '2027-01-10', '2027-01-31')])).rejects.toThrow(
        OverlappingSeasonCalendarError,
      );
      expect(await revisionsOf(2027)).toEqual([]);
    });

    it('rechaza publicar el año de inicio con un BASE que llega a un período ya publicado del año siguiente', async () => {
      await publish(2027, [base(eventoId, '2027-01-01', '2027-01-31')]);

      await expect(publish(2026, [base(altaId, '2026-12-20', '2027-01-01')])).rejects.toThrow(
        OverlappingSeasonCalendarError,
      );
      expect(await revisionsOf(2026)).toEqual([]);
    });

    it('acepta BASE contiguos entre años (el día siguiente al fin del heredado)', async () => {
      await publish(2026, [base(altaId, '2026-12-20', '2027-01-10')]);

      await expect(
        publish(2027, [base(eventoId, '2027-01-11', '2027-01-31')]),
      ).resolves.toMatchObject({ revision: 1 });
      expect(await overlappingActiveBases()).toBe(0);
    });

    it('si el solape se cuela sin la validación del dominio, la restricción de exclusión lo rechaza (23P01)', async () => {
      await publish(2026, [base(altaId, '2026-12-20', '2027-01-10')]);

      await expect(
        calendars.publish(
          draft(2027, [base(eventoId, '2027-01-05', '2027-01-20')]),
          ADMIN,
          () => {},
        ),
      ).rejects.toThrow(OverlappingSeasonCalendarError);
      expect(await revisionsOf(2027)).toEqual([]);
    });
  });

  describe('uso de temporadas para 009', () => {
    it('una temporada está en uso solo mientras una revisión ACTIVA la asigna', async () => {
      await publish(2026, [exception(eventoId, '2026-07-04')]);
      expect(await calendars.isReferencedByActiveRevision(eventoId)).toBe(true);

      await publish(2026, [base(altaId, '2026-06-01', '2026-08-31')], 1);

      expect(await calendars.isReferencedByActiveRevision(eventoId)).toBe(false);
      expect(await calendars.isReferencedByActiveRevision(altaId)).toBe(true);
    });
  });

  describe('restricciones de la migración (T038)', () => {
    // En las claves únicas (23505) Prisma muestra las columnas repetidas y no el nombre
    // del índice: cada índice se reconoce por sus columnas.
    it('una sola revisión activa por año', async () => {
      await insertRawRevision(2026, 1, true, []);
      await expect(insertRawRevision(2026, 2, true, [])).rejects.toThrow(
        /23505.*Key \(year\)=\(2026\)/s,
      );
    });

    it('números de revisión únicos por año', async () => {
      await insertRawRevision(2026, 1, false, []);
      await expect(insertRawRevision(2026, 1, false, [])).rejects.toThrow(
        /23505.*Key \(year, revision\)=\(2026, 1\)/s,
      );
    });

    it.each([
      [
        'kind desconocido',
        { kind: 'OTRO', startDate: '2026-07-04', endDate: '2026-07-04' },
        'season_calendar_entry_kind',
      ],
      [
        'fin antes del inicio',
        { kind: 'BASE', startDate: '2026-08-31', endDate: '2026-06-01' },
        'season_calendar_entry_valid_interval',
      ],
      [
        'inicio fuera del año',
        { kind: 'BASE', startDate: '2025-12-31', endDate: '2026-01-10' },
        'season_calendar_entry_start_in_year',
      ],
      [
        'BASE más allá del año siguiente',
        { kind: 'BASE', startDate: '2026-12-01', endDate: '2028-01-01' },
        'season_calendar_entry_base_until_next_year',
      ],
      [
        'excepción de varios días',
        { kind: 'EXCEPTION', startDate: '2026-07-04', endDate: '2026-07-05' },
        'season_calendar_entry_exception_single_day',
      ],
    ])('rechaza una entrada con %s', async (_case, entry, constraint) => {
      await expect(
        insertRawRevision(2026, 1, false, [{ seasonId: altaId, ...entry }]),
      ).rejects.toThrow(new RegExp(constraint));
    });

    it('rechaza dos excepciones en la misma fecha de una revisión', async () => {
      await expect(
        insertRawRevision(2026, 1, false, [
          exception(altaId, '2026-07-04'),
          exception(eventoId, '2026-07-04'),
        ]),
      ).rejects.toThrow(/23505.*Key \(revision_id, start_date\)=.*2026-07-04/s);
    });

    it('rechaza una entrada que apunta a una temporada que no existe', async () => {
      await expect(
        insertRawRevision(2026, 1, false, [exception(randomUUID(), '2026-07-04')]),
      ).rejects.toThrow(/season_calendar_entry_season_id_fkey/);
    });

    it('rechaza dos BASE activos que comparten un día aunque sean de años distintos', async () => {
      await publish(2026, [base(altaId, '2026-12-20', '2027-01-10')]);
      const revisionId = await insertRawRevision(2027, 1, true, [
        base(eventoId, '2027-01-10', '2027-01-31'),
      ]);

      await expect(
        prisma.$executeRaw`
          INSERT INTO season_calendar_active_base (calendar_entry_id, year, period)
          SELECT id, year, daterange(start_date, end_date, '[]')
          FROM season_calendar_entry WHERE revision_id = ${revisionId}::uuid`,
      ).rejects.toThrow(/season_calendar_active_base_no_overlap|23P01/);
    });
  });
});
