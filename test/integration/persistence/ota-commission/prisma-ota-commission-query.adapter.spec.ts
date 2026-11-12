// Feature 003 · Consultar porcentaje de comisión OTA (T009, T024, T025, T026)
// Lectura real del porcentaje más reciente de una OTA contra PostgreSQL. Necesita una base ya
// migrada:
//   TEST_DATABASE_URL=... npx prisma migrate deploy   (con DATABASE_URL apuntando a ella)
//   TEST_DATABASE_URL=... npm test
// Sin TEST_DATABASE_URL estas pruebas se omiten. Usa OTA y reservas propias (ota-it-003-*),
// así puede correr en paralelo con otras suites que también guardan liquidaciones.
import { NewSettlement } from '../../../../src/domain/model/settlement/settlement';
import { SettlementMapper } from '../../../../src/infrastructure/adapters/out/persistence/mappers/settlement/settlement.mapper';
import { PrismaService } from '../../../../src/infrastructure/adapters/out/persistence/prisma.service';
import { PrismaOtaCommissionQueryAdapter } from '../../../../src/infrastructure/adapters/out/persistence/repositories/ota-commission/prisma-ota-commission-query.adapter';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeWithDatabase = TEST_DATABASE_URL ? describe : describe.skip;

const OTA_A = 'ota-it-003-a';
const OTA_B = 'ota-it-003-b';
const OTA_EMPTY = 'ota-it-003-sin-historial';
const RESERVATION_PREFIX = 'RES-IT-003-';
const ROOM_ID = '5f0e8a47-1b2c-4d3e-9f6a-7b8c9d0e1f23';

let next = 0;
function uuid(prefix: string): string {
  next += 1;
  return `${prefix}-0000-4000-8000-${String(next).padStart(12, '0')}`;
}

function otaSettlement(otaId: string, percentage: string): NewSettlement {
  return {
    settlementId: uuid('e3003000'),
    stayId: uuid('e3003100'),
    reservationRef: `${RESERVATION_PREFIX}${next}`,
    roomId: ROOM_ID,
    categoryRoom: 'DOBLE',
    checkInDate: '2026-12-20',
    checkOutDate: '2026-12-23',
    quoteId: 'a1f2c3d4-e5b6-4789-8a9b-0c1d2e3f4a5b',
    channel: 'OTA',
    otaId,
    otaConfirmationCode: `CONF-${next}`,
    otaCommissionPercentage: percentage,
    currency: 'COP',
    lodgingAmount: '750000.00',
    baseLodgingAmount: '700000.00',
    dynamicAdjustmentAmount: '50000.00',
    otaCommissionAmount: '112500.00',
    netIncome: '637500.00',
    sourceEventId: uuid('e3003200'),
  };
}

function directSettlement(): NewSettlement {
  return {
    ...otaSettlement(OTA_A, '0.00'),
    channel: 'DIRECT',
    otaId: null,
    otaConfirmationCode: null,
    otaCommissionPercentage: null,
    otaCommissionAmount: '0.00',
    netIncome: '750000.00',
  };
}

describeWithDatabase('PrismaOtaCommissionQueryAdapter (PostgreSQL real)', () => {
  let prisma: PrismaService;
  let adapter: PrismaOtaCommissionQueryAdapter;

  // Guarda la liquidación y fija su generated_at (en la operación lo pone la base de datos).
  async function save(settlement: NewSettlement, generatedAt: string): Promise<void> {
    await prisma.settlement.create({ data: SettlementMapper.toCreateInput(settlement) });
    await prisma.$executeRaw`UPDATE settlement SET generated_at = ${generatedAt}::timestamptz WHERE id = ${settlement.settlementId}::uuid`;
  }

  async function cleanUp(): Promise<void> {
    await prisma.settlement.deleteMany({
      where: { reservationRef: { startsWith: RESERVATION_PREFIX } },
    });
  }

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    prisma = new PrismaService();
    await prisma.$connect();
    adapter = new PrismaOtaCommissionQueryAdapter(prisma);
  });

  beforeEach(cleanUp);

  afterAll(async () => {
    await cleanUp();
    await prisma.$disconnect();
  });

  it('devuelve la liquidación más reciente de la OTA con su porcentaje, id y fecha (T009)', async () => {
    const older = otaSettlement(OTA_A, '12.00');
    const latest = otaSettlement(OTA_A, '15.00');
    const middle = otaSettlement(OTA_A, '13.50');
    await save(older, '2026-01-10T10:00:00Z');
    await save(latest, '2026-11-10T10:00:00Z');
    await save(middle, '2026-06-10T10:00:00Z');

    const found = await adapter.findLatestByOtaId(OTA_A);

    expect(found).not.toBeNull();
    expect(found!.otaId).toBe(OTA_A);
    expect(found!.percentage.toString()).toBe('15.00');
    expect(found!.settlementId).toBe(latest.settlementId);
    expect(found!.settlementDate.toISOString()).toBe('2026-11-10T10:00:00.000Z');
  });

  it('no promedia: con porcentajes distintos en el tiempo toma el más reciente (T024)', async () => {
    await save(otaSettlement(OTA_A, '20.00'), '2026-03-01T00:00:00Z');
    await save(otaSettlement(OTA_A, '10.00'), '2026-04-01T00:00:00Z');

    expect((await adapter.findLatestByOtaId(OTA_A))!.percentage.toString()).toBe('10.00');
  });

  it('nunca devuelve el canal directo, aunque sea más reciente (FR-006, NFR-004)', async () => {
    await save(otaSettlement(OTA_A, '15.00'), '2026-05-01T00:00:00Z');
    await save(directSettlement(), '2026-12-01T00:00:00Z');

    const found = await adapter.findLatestByOtaId(OTA_A);

    expect(found!.percentage.toString()).toBe('15.00');
  });

  it('no mezcla OTAs: cada una ve solo sus liquidaciones (NFR-003)', async () => {
    await save(otaSettlement(OTA_A, '15.00'), '2026-05-01T00:00:00Z');
    await save(otaSettlement(OTA_B, '18.00'), '2026-12-01T00:00:00Z');

    expect((await adapter.findLatestByOtaId(OTA_A))!.percentage.toString()).toBe('15.00');
    expect((await adapter.findLatestByOtaId(OTA_B))!.percentage.toString()).toBe('18.00');
  });

  it('sin liquidaciones devuelve null (FR-004)', async () => {
    expect(await adapter.findLatestByOtaId(OTA_EMPTY)).toBeNull();
  });

  it('una liquidación muy antigua sigue siendo la referencia: no expira (T025)', async () => {
    await save(otaSettlement(OTA_A, '9.00'), '2015-02-01T00:00:00Z');

    const found = await adapter.findLatestByOtaId(OTA_A);

    expect(found!.percentage.toString()).toBe('9.00');
    expect(found!.settlementDate.toISOString()).toBe('2015-02-01T00:00:00.000Z');
  });

  it('dos liquidaciones del mismo instante: siempre devuelve la misma (NFR-001)', async () => {
    await save(otaSettlement(OTA_A, '11.00'), '2026-07-01T00:00:00Z');
    await save(otaSettlement(OTA_A, '14.00'), '2026-07-01T00:00:00Z');

    const results = await Promise.all([1, 2, 3].map(() => adapter.findLatestByOtaId(OTA_A)));

    expect(new Set(results.map((item) => item!.settlementId)).size).toBe(1);
  });

  it('la consulta no modifica settlement (T026, FR-005)', async () => {
    await save(otaSettlement(OTA_A, '15.00'), '2026-05-01T00:00:00Z');
    const snapshot = async () =>
      prisma.settlement.findMany({
        where: { reservationRef: { startsWith: RESERVATION_PREFIX } },
        orderBy: { id: 'asc' },
      });
    const before = await snapshot();

    await adapter.findLatestByOtaId(OTA_A);
    await adapter.findLatestByOtaId(OTA_EMPTY);

    expect(await snapshot()).toEqual(before);
  });

  it('usa el índice (ota_id, generated_at DESC) de 007 (T002, T029)', async () => {
    const indexes = await prisma.$queryRaw<{ indexdef: string }[]>`
      SELECT indexdef FROM pg_indexes WHERE tablename = 'settlement'`;

    expect(indexes.some(({ indexdef }) => /\(ota_id, generated_at DESC\)/.test(indexdef))).toBe(
      true,
    );
  });
});
