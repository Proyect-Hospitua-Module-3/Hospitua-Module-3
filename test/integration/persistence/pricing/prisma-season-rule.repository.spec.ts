// Feature 009 · Modificar precio tarifa según temporada
// Repositorio real contra PostgreSQL (T016, T023, T031, T037). Necesita una base ya migrada
// en TEST_DATABASE_URL; sin esa variable estas pruebas se omiten.
// ¡Borra y recrea el catálogo de temporadas de esa base (y el calendario de 011, que lo referencia)!
import { DefaultSeasonImmutableError } from '../../../../src/domain/errors/pricing/default-season-immutable.error';
import { SeasonNameConflictError } from '../../../../src/domain/errors/pricing/season-name-conflict.error';
import { SeasonNotFoundError } from '../../../../src/domain/errors/pricing/season-not-found.error';
import { SeasonRuleConflictError } from '../../../../src/domain/errors/pricing/season-rule-conflict.error';
import { Season } from '../../../../src/domain/model/pricing/season';
import { SeasonAdjustmentPercent } from '../../../../src/domain/model/pricing/season-adjustment-percent.vo';
import { SeasonColor } from '../../../../src/domain/model/pricing/season-color.vo';
import { SeasonName } from '../../../../src/domain/model/pricing/season-name.vo';
import { PrismaService } from '../../../../src/infrastructure/adapters/out/persistence/prisma.service';
import { PrismaSeasonRuleRepository } from '../../../../src/infrastructure/adapters/out/persistence/repositories/pricing/prisma-season-rule.repository';
import {
  lockPricingTestDatabase,
  PRICING_TEST_LOCK_TIMEOUT_MS,
} from '../../../support/database/pricing-test-database-lock';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeWithDatabase = TEST_DATABASE_URL ? describe : describe.skip;

const ADMIN = 'f2d3b4a5-6c7d-4e8f-9012-3456789abcde';
const REGULAR_ID = '00000000-0000-4000-8000-000000000001';

const adjust = (value: string) => (current: Season) =>
  current.planChange({ adjustmentPercent: SeasonAdjustmentPercent.of(value) });

describeWithDatabase('PrismaSeasonRuleRepository (PostgreSQL real)', () => {
  let prisma: PrismaService;
  let repository: PrismaSeasonRuleRepository;
  let unlockDatabase: () => Promise<void>;

  beforeAll(async () => {
    // La suite de 011 borra las mismas tablas: se turnan.
    unlockDatabase = await lockPricingTestDatabase(TEST_DATABASE_URL!);
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    prisma = new PrismaService();
    await prisma.$connect();
    repository = new PrismaSeasonRuleRepository(prisma);
  }, PRICING_TEST_LOCK_TIMEOUT_MS);

  // Deja el catálogo como recién migrado: solo Regular, igual que la migración.
  beforeEach(async () => {
    // El calendario de 011 referencia temporadas: se borra primero.
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
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    await unlockDatabase?.();
  });

  function newSeason(name: string, adjustment = '20') {
    return {
      name: SeasonName.of(name),
      color: SeasonColor.of('#E67E22'),
      adjustmentPercent: SeasonAdjustmentPercent.of(adjustment),
    };
  }

  async function rulesOf(seasonId: string) {
    return prisma.seasonRule.findMany({ where: { seasonId }, orderBy: { validFrom: 'asc' } });
  }

  async function historyOf(seasonId: string) {
    return prisma.seasonRuleHistory.findMany({ where: { seasonId }, orderBy: { changedAt: 'asc' } });
  }

  // Un instante claramente posterior a lo ya confirmado (JavaScript solo ve milisegundos).
  async function afterCommit(): Promise<Date> {
    await new Promise((resolve) => setTimeout(resolve, 5));
    return new Date();
  }

  it('el catálogo inicial tiene solo Regular, con ajuste 0.00 (T037)', async () => {
    const catalog = await repository.listActive();

    expect(catalog.seasons).toHaveLength(1);
    expect(catalog.seasons[0]).toMatchObject({ id: REGULAR_ID, isDefault: true, version: 1 });
    expect(catalog.seasons[0].currentRule.adjustmentPercent.toString()).toBe('0.00');
  });

  it('crear deja la temporada, su primera regla y una entrada CREATE en el historial', async () => {
    const alta = await repository.create(newSeason('Alta', '20'), ADMIN);

    expect(alta.version).toBe(1);
    const [rule] = await rulesOf(alta.id);
    expect(rule.adjustmentPercent.toFixed(2)).toBe('20.00');
    expect(rule.validTo).toBeNull();
    const [entry] = await historyOf(alta.id);
    expect(entry).toMatchObject({ changeType: 'CREATE', changedBy: ADMIN });
  });

  it('el nombre es único entre temporadas activas, sin distinguir mayúsculas ni espacios', async () => {
    await repository.create(newSeason('Alta'), ADMIN);

    await expect(repository.create(newSeason(' ALTA '), ADMIN)).rejects.toThrow(SeasonNameConflictError);
  });

  it('cambiar el ajuste cierra la versión anterior en el mismo instante en que empieza la nueva (FR-003)', async () => {
    const alta = await repository.create(newSeason('Alta', '20'), ADMIN);

    const updated = await repository.modify(alta.id, ADMIN, adjust('35'));

    expect(updated.version).toBe(2);
    const [previous, current] = await rulesOf(alta.id);
    expect(previous.validTo).not.toBeNull();
    expect(current.validTo).toBeNull();
    const [{ same }] = await prisma.$queryRaw<{ same: boolean }[]>`
      SELECT bool_and(a.valid_to = b.valid_from) AS same
      FROM season_rule a JOIN season_rule b ON a.season_id = b.season_id AND a.valid_to IS NOT NULL AND b.valid_to IS NULL
      WHERE a.season_id = ${alta.id}::uuid`;
    expect(same).toBe(true);
    const history = await historyOf(alta.id);
    expect(history.at(-1)).toMatchObject({ changeType: 'UPDATE' });
    expect(history.at(-1)!.previousAdjustment!.toFixed(2)).toBe('20.00');
    expect(history.at(-1)!.newAdjustment!.toFixed(2)).toBe('35.00');
  });

  it('un cambio idéntico no crea versión ni historial (T031)', async () => {
    const alta = await repository.create(newSeason('Alta', '20'), ADMIN);

    const same = await repository.modify(alta.id, ADMIN, adjust('20.00'));

    expect(same.version).toBe(1);
    expect(await rulesOf(alta.id)).toHaveLength(1);
    expect(await historyOf(alta.id)).toHaveLength(1);
  });

  it('si el dominio rechaza el cambio, no queda nada a medias', async () => {
    const alta = await repository.create(newSeason('Alta', '20'), ADMIN);

    await expect(
      repository.modify(alta.id, ADMIN, (current) =>
        current.planChange({ adjustmentPercent: SeasonAdjustmentPercent.of('50') }, 99),
      ),
    ).rejects.toThrow(SeasonRuleConflictError);

    expect(await rulesOf(alta.id)).toHaveLength(1);
    expect(await historyOf(alta.id)).toHaveLength(1);
  });

  it('si falla el historial, el cambio de la temporada también se revierte (T016)', async () => {
    const alta = await repository.create(newSeason('Alta', '20'), ADMIN);
    await prisma.$executeRawUnsafe(
      'ALTER TABLE season_rule_history ADD CONSTRAINT test_rechaza_siete CHECK (new_adjustment IS DISTINCT FROM 7)',
    );
    try {
      await expect(repository.modify(alta.id, ADMIN, adjust('7'))).rejects.toThrow();
    } finally {
      await prisma.$executeRawUnsafe('ALTER TABLE season_rule_history DROP CONSTRAINT test_rechaza_siete');
    }

    const [current] = (await repository.listActive()).seasons.filter((s) => s.id === alta.id);
    expect(current.version).toBe(1);
    expect(current.currentRule.adjustmentPercent.toString()).toBe('20.00');
    expect(await rulesOf(alta.id)).toHaveLength(1);
  });

  it('modificaciones simultáneas se serializan: una sola versión vigente y sin solapes (NFR-002)', async () => {
    const alta = await repository.create(newSeason('Alta', '20'), ADMIN);
    const values = ['1', '2', '3', '4', '5', '6', '7', '8'];

    await Promise.all(values.map((v) => repository.modify(alta.id, ADMIN, adjust(v))));

    const rules = await rulesOf(alta.id);
    expect(rules).toHaveLength(values.length + 1);
    expect(rules.filter((r) => r.validTo === null)).toHaveLength(1);
    for (let i = 1; i < rules.length; i++) {
      expect(rules[i - 1].validTo!.getTime()).toBe(rules[i].validFrom.getTime());
    }
    const [current] = (await repository.listActive()).seasons.filter((s) => s.id === alta.id);
    expect(current.version).toBe(values.length + 1);
  });

  it('con la misma expectedVersion, solo una de varias modificaciones simultáneas gana', async () => {
    const alta = await repository.create(newSeason('Alta', '20'), ADMIN);

    const results = await Promise.allSettled(
      ['30', '40', '50'].map((v) =>
        repository.modify(alta.id, ADMIN, (current) =>
          current.planChange({ adjustmentPercent: SeasonAdjustmentPercent.of(v) }, 1),
        ),
      ),
    );

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(rejected).toHaveLength(2);
    rejected.forEach((r) => expect(r.reason).toBeInstanceOf(SeasonRuleConflictError));
  });

  it('retirar es lógico: conserva la fila, sus reglas y su historial, y libera el nombre (FR-001)', async () => {
    const alta = await repository.create(newSeason('Alta', '20'), ADMIN);

    await repository.retire(alta.id, ADMIN, async () => undefined);

    const row = await prisma.season.findUnique({ where: { id: alta.id } });
    expect(row?.archivedAt).not.toBeNull();
    expect(row?.archivedBy).toBe(ADMIN);
    expect((await rulesOf(alta.id)).every((r) => r.validTo !== null)).toBe(true);
    expect((await historyOf(alta.id)).map((h) => h.changeType)).toEqual(['CREATE', 'RETIRE']);
    await expect(repository.modify(alta.id, ADMIN, adjust('5'))).rejects.toThrow(SeasonNotFoundError);
    await expect(repository.create(newSeason('alta'), ADMIN)).resolves.toBeDefined();
  });

  it('si la autorización del retiro falla, no cambia nada', async () => {
    await expect(
      repository.retire(REGULAR_ID, ADMIN, async (current) => current.assertCanBeRetired()),
    ).rejects.toThrow(DefaultSeasonImmutableError);

    expect((await repository.listActive()).seasons.map((s) => s.id)).toContain(REGULAR_ID);
  });

  it('la base de datos impide retirar Regular aunque se salte la aplicación', async () => {
    await expect(
      prisma.$executeRaw`UPDATE season SET archived_at = now(), archived_by = ${ADMIN}::uuid WHERE id = ${REGULAR_ID}::uuid`,
    ).rejects.toThrow();
  });

  it('la base de datos impide dos versiones solapadas de una temporada (FR-003)', async () => {
    await expect(
      prisma.$executeRaw`
        INSERT INTO season_rule (season_id, adjustment_percent, valid_from, valid_to, created_at, created_by)
        SELECT id, 10, now() - interval '1 day', now() + interval '1 day', now(), ${ADMIN}::uuid
        FROM season WHERE id = ${REGULAR_ID}::uuid`,
    ).rejects.toThrow();
  });

  it('findEffectiveAt toma la versión vigente en asOf: antes ve la anterior, después la nueva (T023)', async () => {
    const alta = await repository.create(newSeason('Alta', '20'), ADMIN);
    const before = await afterCommit();
    await repository.modify(alta.id, ADMIN, adjust('35'));
    const after = await afterCommit();

    const atBefore = (await repository.findEffectiveAt(before)).find((s) => s.seasonId === alta.id);
    const atAfter = (await repository.findEffectiveAt(after)).find((s) => s.seasonId === alta.id);

    expect(atBefore?.adjustmentPercent.toString()).toBe('20.00');
    expect(atAfter?.adjustmentPercent.toString()).toBe('35.00');
  });

  it('findEffectiveAt incluye las retiradas con su última regla y omite las creadas después de asOf', async () => {
    const alta = await repository.create(newSeason('Alta', '20'), ADMIN);
    await repository.retire(alta.id, ADMIN, async () => undefined);
    const asOf = await afterCommit();
    await repository.create(newSeason('Baja', '-15'), ADMIN);

    const snapshot = await repository.findEffectiveAt(asOf);

    expect(snapshot.map((s) => s.name.value)).toEqual(['Alta', 'Regular']);
    expect(snapshot[0].archivedAt).not.toBeNull();
    expect(snapshot[0].adjustmentPercent.toString()).toBe('20.00');
  });
});
