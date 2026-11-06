// Feature 007 · Generar liquidación (T017, T027)
// Archivo de acceso a datos real contra PostgreSQL. Necesita una base ya migrada:
//   TEST_DATABASE_URL=... npx prisma migrate deploy   (con DATABASE_URL apuntando a ella)
//   TEST_DATABASE_URL=... npm test
// Sin TEST_DATABASE_URL estas pruebas se omiten. Solo borra las liquidaciones de sus
// propias estancias, así que puede correr en paralelo con otras suites.
import { NewSettlement } from '../../../../src/domain/model/settlement/settlement';
import { STAY_ALREADY_SETTLED } from '../../../../src/domain/ports/out/settlement/settlement.repository.port';
import { PrismaService } from '../../../../src/infrastructure/adapters/out/persistence/prisma.service';
import { PrismaSettlementRepository } from '../../../../src/infrastructure/adapters/out/persistence/repositories/settlement/prisma-settlement.repository';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeWithDatabase = TEST_DATABASE_URL ? describe : describe.skip;

const STAY_DIRECT = '70000000-0000-4000-8000-000000000001';
const STAY_OTA = '70000000-0000-4000-8000-000000000002';
const STAY_RACE = '70000000-0000-4000-8000-000000000003';
const STAY_INVALID = '70000000-0000-4000-8000-000000000004';
const OWN_STAYS = [STAY_DIRECT, STAY_OTA, STAY_RACE, STAY_INVALID];
const ROOM_ID = '5f0e8a47-1b2c-4d3e-9f6a-7b8c9d0e1f23';
const QUOTE_ID = 'a1f2c3d4-e5b6-4789-8a9b-0c1d2e3f4a5b';
const RESERVATION_REF = 'RES-IT-007';

let nextId = 0;
function settlementId(): string {
  nextId += 1;
  return `71000000-0000-4000-8000-${String(nextId).padStart(12, '0')}`;
}

function direct(stayId: string, overrides: Partial<NewSettlement> = {}): NewSettlement {
  return {
    settlementId: settlementId(),
    stayId,
    reservationRef: RESERVATION_REF,
    roomId: ROOM_ID,
    categoryRoom: 'DOBLE',
    checkInDate: '2026-12-20',
    checkOutDate: '2026-12-23',
    quoteId: QUOTE_ID,
    channel: 'DIRECT',
    otaId: null,
    otaConfirmationCode: null,
    otaCommissionPercentage: null,
    currency: 'COP',
    lodgingAmount: '540000.00',
    baseLodgingAmount: '600000.00',
    dynamicAdjustmentAmount: '-60000.00',
    otaCommissionAmount: '0.00',
    netIncome: '540000.00',
    sourceEventId: '9b1f6d3e-2c4a-4f7b-8e5d-3a1c0b9d8e72',
    ...overrides,
  };
}

function ota(stayId: string): NewSettlement {
  return direct(stayId, {
    channel: 'OTA',
    otaId: 'booking',
    otaConfirmationCode: 'BKG-88421',
    otaCommissionPercentage: '15.00',
    lodgingAmount: '750000.00',
    baseLodgingAmount: '700000.00',
    dynamicAdjustmentAmount: '50000.00',
    otaCommissionAmount: '112500.00',
    netIncome: '637500.00',
  });
}

describeWithDatabase('PrismaSettlementRepository (PostgreSQL real)', () => {
  let prisma: PrismaService;
  let repository: PrismaSettlementRepository;

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    prisma = new PrismaService();
    await prisma.$connect();
    repository = new PrismaSettlementRepository(prisma);
  });

  beforeEach(async () => {
    await prisma.settlement.deleteMany({ where: { stayId: { in: OWN_STAYS } } });
  });

  afterAll(async () => {
    await prisma.settlement.deleteMany({ where: { stayId: { in: OWN_STAYS } } });
    await prisma.$disconnect();
  });

  it('guarda una liquidación directa y la lee igual, con generatedAt de la base de datos', async () => {
    const before = Date.now();
    const toSave = direct(STAY_DIRECT);

    const saved = await repository.insert(toSave);
    const read = await repository.findByStayId(STAY_DIRECT);

    expect(saved).not.toBe(STAY_ALREADY_SETTLED);
    expect(read).toEqual(saved);
    expect({ ...read, generatedAt: undefined, status: undefined }).toEqual({
      ...toSave,
      generatedAt: undefined,
      status: undefined,
    });
    expect(read?.status).toBe('FINAL');
    // Ajuste dinámico negativo guardado tal cual.
    expect(read?.dynamicAdjustmentAmount).toBe('-60000.00');
    expect(Math.abs((read?.generatedAt.getTime() ?? 0) - before)).toBeLessThan(60_000);
  });

  it('guarda una liquidación OTA con la OTA, su código, el porcentaje y la comisión', async () => {
    await repository.insert(ota(STAY_OTA));

    await expect(repository.findByStayId(STAY_OTA)).resolves.toMatchObject({
      channel: 'OTA',
      otaId: 'booking',
      otaConfirmationCode: 'BKG-88421',
      otaCommissionPercentage: '15.00',
      otaCommissionAmount: '112500.00',
      netIncome: '637500.00',
    });
  });

  it('una segunda inserción de la misma estancia → STAY_ALREADY_SETTLED y la original intacta (T027)', async () => {
    const original = await repository.insert(direct(STAY_DIRECT));

    const second = await repository.insert(direct(STAY_DIRECT, { checkOutDate: '2026-12-24' }));

    expect(second).toBe(STAY_ALREADY_SETTLED);
    await expect(repository.findByStayId(STAY_DIRECT)).resolves.toEqual(original);
  });

  it('dos inserciones simultáneas de la misma estancia terminan en una sola fila (T017)', async () => {
    const results = await Promise.all([
      repository.insert(direct(STAY_RACE)),
      repository.insert(direct(STAY_RACE)),
      repository.insert(direct(STAY_RACE)),
    ]);

    expect(results.filter((result) => result === STAY_ALREADY_SETTLED)).toHaveLength(2);
    await expect(prisma.settlement.count({ where: { stayId: STAY_RACE } })).resolves.toBe(1);
  });

  it('findByStayId de una estancia sin liquidación → null', async () => {
    await expect(repository.findByStayId(STAY_DIRECT)).resolves.toBeNull();
  });

  it('findByReservationAndRoom (para 002) la encuentra por reserva y habitación', async () => {
    const saved = await repository.insert(direct(STAY_DIRECT));

    await expect(repository.findByReservationAndRoom(RESERVATION_REF, ROOM_ID)).resolves.toEqual(
      saved,
    );
    await expect(
      repository.findByReservationAndRoom(RESERVATION_REF, '6a1f9b58-2c3d-4e4f-8a7b-8c9d0e1f2a34'),
    ).resolves.toBeNull();
    await expect(
      repository.findByReservationAndRoom(RESERVATION_REF, 'no-es-uuid'),
    ).resolves.toBeNull();
  });

  it.each([
    ['un ingreso neto que no cuadra', { netIncome: '1.00' }],
    ['un ajuste dinámico que no cuadra', { dynamicAdjustmentAmount: '0.00' }],
    ['canal directo con comisión', { otaCommissionAmount: '10.00', netIncome: '539990.00' }],
    ['canal OTA sin datos de la OTA', { channel: 'OTA' as const }],
    ['salida anterior a la entrada', { checkOutDate: '2026-12-19' }],
    ['otra moneda', { currency: 'USD' }],
  ])('los CHECK de la tabla rechazan %s (NFR-007)', async (_label, overrides) => {
    await expect(repository.insert(direct(STAY_INVALID, overrides))).rejects.toThrow();
    await expect(repository.findByStayId(STAY_INVALID)).resolves.toBeNull();
  });
});
