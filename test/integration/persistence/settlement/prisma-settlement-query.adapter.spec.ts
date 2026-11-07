// Feature 002 · Consultar liquidación (T006)
// Lectura real de liquidaciones Final para la OTA contra PostgreSQL. Necesita una base ya
// migrada:
//   TEST_DATABASE_URL=... npx prisma migrate deploy   (con DATABASE_URL apuntando a ella)
//   TEST_DATABASE_URL=... npm test
// Sin TEST_DATABASE_URL estas pruebas se omiten. Solo crea y borra liquidaciones de sus
// propias reservas, así que puede correr en paralelo con otras suites.
import { NewSettlement } from '../../../../src/domain/model/settlement/settlement';
import { SettlementMapper } from '../../../../src/infrastructure/adapters/out/persistence/mappers/settlement/settlement.mapper';
import { PrismaService } from '../../../../src/infrastructure/adapters/out/persistence/prisma.service';
import { PrismaSettlementQueryAdapter } from '../../../../src/infrastructure/adapters/out/persistence/repositories/settlement/prisma-settlement-query.adapter';
import { readOnlyTransaction } from '../../../../src/infrastructure/adapters/out/persistence/repositories/settlement/read-only-transaction';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeWithDatabase = TEST_DATABASE_URL ? describe : describe.skip;

const RES_BOOKING = 'RES-IT-002-BOOKING';
const RES_DIRECT = 'RES-IT-002-DIRECTA';
const RES_EXPEDIA = 'RES-IT-002-EXPEDIA';
const RES_EMPTY = 'RES-IT-002-VACIA';
const OWN_RESERVATIONS = [RES_BOOKING, RES_DIRECT, RES_EXPEDIA, RES_EMPTY];
const ROOM_A = '5f0e8a47-1b2c-4d3e-9f6a-7b8c9d0e1f23';
const ROOM_B = '6a1f9b58-2c3d-4e4f-8a7b-8c9d0e1f2a34';
const ROOM_C = '7b2a0c69-3d4e-4f5a-9b8c-9d0e1f2a3b45';

let next = 0;
function uuid(prefix: string): string {
  next += 1;
  return `${prefix}-0000-4000-8000-${String(next).padStart(12, '0')}`;
}

function otaSettlement(
  reservationRef: string,
  roomId: string,
  overrides: Partial<NewSettlement> = {},
): NewSettlement {
  return {
    settlementId: uuid('e2000000'),
    stayId: uuid('e3000000'),
    reservationRef,
    roomId,
    categoryRoom: 'DOBLE',
    checkInDate: '2026-12-20',
    checkOutDate: '2026-12-23',
    quoteId: 'a1f2c3d4-e5b6-4789-8a9b-0c1d2e3f4a5b',
    channel: 'OTA',
    otaId: 'booking',
    otaConfirmationCode: 'BKG-88421',
    otaCommissionPercentage: '15.00',
    currency: 'COP',
    lodgingAmount: '750000.00',
    baseLodgingAmount: '700000.00',
    dynamicAdjustmentAmount: '50000.00',
    otaCommissionAmount: '112500.00',
    netIncome: '637500.00',
    sourceEventId: '9b1f6d3e-2c4a-4f7b-8e5d-3a1c0b9d8e72',
    ...overrides,
  };
}

function directSettlement(reservationRef: string, roomId: string): NewSettlement {
  return otaSettlement(reservationRef, roomId, {
    channel: 'DIRECT',
    otaId: null,
    otaConfirmationCode: null,
    otaCommissionPercentage: null,
    lodgingAmount: '540000.00',
    baseLodgingAmount: '600000.00',
    dynamicAdjustmentAmount: '-60000.00',
    otaCommissionAmount: '0.00',
    netIncome: '540000.00',
  });
}

describeWithDatabase('PrismaSettlementQueryAdapter (PostgreSQL real)', () => {
  let prisma: PrismaService;
  let adapter: PrismaSettlementQueryAdapter;

  async function save(...settlements: NewSettlement[]): Promise<void> {
    for (const settlement of settlements) {
      await prisma.settlement.create({ data: SettlementMapper.toCreateInput(settlement) });
    }
  }

  async function cleanUp(): Promise<void> {
    await prisma.settlement.deleteMany({ where: { reservationRef: { in: OWN_RESERVATIONS } } });
  }

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    prisma = new PrismaService();
    await prisma.$connect();
    adapter = new PrismaSettlementQueryAdapter(prisma);
  });

  beforeEach(cleanUp);

  afterAll(async () => {
    await cleanUp();
    await prisma.$disconnect();
  });

  it('devuelve las Final de la reserva de la OTA, ordenadas por roomId, con los importes guardados', async () => {
    await save(
      otaSettlement(RES_BOOKING, ROOM_C),
      otaSettlement(RES_BOOKING, ROOM_A),
      otaSettlement(RES_BOOKING, ROOM_B, {
        lodgingAmount: '540000.00',
        baseLodgingAmount: '600000.00',
        dynamicAdjustmentAmount: '-60000.00',
        otaCommissionAmount: '81000.00',
        netIncome: '459000.00',
      }),
    );

    const found = await adapter.findByReservationRefAndOtaId(RES_BOOKING, 'booking');

    expect(found.map((settlement) => settlement.roomId)).toEqual([ROOM_A, ROOM_B, ROOM_C]);
    expect(found[1]).toMatchObject({
      reservationRef: RES_BOOKING,
      channel: 'OTA',
      otaId: 'booking',
      otaCommissionPercentage: '15.00',
      lodgingAmount: '540000.00',
      baseLodgingAmount: '600000.00',
      dynamicAdjustmentAmount: '-60000.00',
      netIncome: '459000.00',
      status: 'FINAL',
    });
    expect(found[0].generatedAt).toBeInstanceOf(Date);
  });

  it('no devuelve liquidaciones del canal directo ni de otra OTA (FR-006, NFR-003)', async () => {
    await save(
      directSettlement(RES_DIRECT, ROOM_A),
      otaSettlement(RES_EXPEDIA, ROOM_A, { otaId: 'expedia', otaConfirmationCode: 'EXP-1' }),
    );

    await expect(adapter.findByReservationRefAndOtaId(RES_DIRECT, 'booking')).resolves.toEqual([]);
    await expect(adapter.findByReservationRefAndOtaId(RES_EXPEDIA, 'booking')).resolves.toEqual([]);
    await expect(
      adapter.findByReservationRefAndOtaId(RES_EXPEDIA, 'expedia'),
    ).resolves.toHaveLength(1);
  });

  it('una reserva sin liquidaciones Final → lista vacía, sin error (FR-005)', async () => {
    await expect(adapter.findByReservationRefAndOtaId(RES_EMPTY, 'booking')).resolves.toEqual([]);
  });

  it('solo trae las de esa reserva: no mezcla otras reservas de la misma OTA', async () => {
    await save(otaSettlement(RES_BOOKING, ROOM_A), otaSettlement(RES_EXPEDIA, ROOM_B));

    const found = await adapter.findByReservationRefAndOtaId(RES_BOOKING, 'booking');

    expect(found.map((settlement) => settlement.reservationRef)).toEqual([RES_BOOKING]);
  });

  it('consultas repetidas devuelven lo mismo y no cambian la tabla (FR-004, FR-008)', async () => {
    await save(otaSettlement(RES_BOOKING, ROOM_A), otaSettlement(RES_BOOKING, ROOM_B));
    const before = await prisma.settlement.findMany({
      where: { reservationRef: RES_BOOKING },
      orderBy: { id: 'asc' },
    });

    const first = await adapter.findByReservationRefAndOtaId(RES_BOOKING, 'booking');
    const second = await adapter.findByReservationRefAndOtaId(RES_BOOKING, 'booking');
    const after = await prisma.settlement.findMany({
      where: { reservationRef: RES_BOOKING },
      orderBy: { id: 'asc' },
    });

    expect(second).toEqual(first);
    expect(after).toEqual(before);
  });

  it('la transacción de lectura es de verdad READ ONLY: PostgreSQL rechaza una escritura dentro de ella', async () => {
    await expect(
      readOnlyTransaction(prisma, (tx) =>
        tx.settlement.create({
          data: SettlementMapper.toCreateInput(otaSettlement(RES_BOOKING, ROOM_A)),
        }),
      ),
    ).rejects.toThrow(/read-only transaction/);
    await expect(prisma.settlement.count({ where: { reservationRef: RES_BOOKING } })).resolves.toBe(
      0,
    );
  });
});
