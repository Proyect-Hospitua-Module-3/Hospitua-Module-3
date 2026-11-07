// Feature 002 · Consultar liquidación (T017, HU3)
// La consulta completa (GetSettlementService con los adaptadores reales de PostgreSQL)
// mientras se procesa el check-out: 007 guarda la Final y después 006 guarda la factura,
// cada una en su propia transacción. Cada actor debe ver solo un resultado permitido y
// completo, nunca uno intermedio o parcial (NFR-002). Módulo 2 y las cotizaciones
// se simulan: no son tablas de 002.
// Necesita una base ya migrada (ver prisma-settlement-query.adapter.spec.ts). Sin
// TEST_DATABASE_URL se omite. Solo crea y borra filas de su propia reserva.
import { Prisma } from '@prisma/client';
import { GetSettlementService } from '../../../../src/application/services/settlement/get-settlement.service';
import { SettlementNotFoundError } from '../../../../src/domain/errors/settlement/settlement-not-found.error';
import { NewSettlement } from '../../../../src/domain/model/settlement/settlement';
import {
  INTERNAL_SETTLEMENT_CALLER,
  SettlementCaller,
} from '../../../../src/domain/model/settlement/settlement-query';
import {
  GetSettlementResult,
  SettlementQueryResult,
} from '../../../../src/domain/model/settlement/settlement-query-result';
import { SettlementMapper } from '../../../../src/infrastructure/adapters/out/persistence/mappers/settlement/settlement.mapper';
import { PrismaService } from '../../../../src/infrastructure/adapters/out/persistence/prisma.service';
import { PrismaSettlementInvoiceQueryAdapter } from '../../../../src/infrastructure/adapters/out/persistence/repositories/settlement/prisma-settlement-invoice-query.adapter';
import { PrismaSettlementQueryAdapter } from '../../../../src/infrastructure/adapters/out/persistence/repositories/settlement/prisma-settlement-query.adapter';
import { PrismaSettlementRepository } from '../../../../src/infrastructure/adapters/out/persistence/repositories/settlement/prisma-settlement.repository';
import { readOnlyTransaction } from '../../../../src/infrastructure/adapters/out/persistence/repositories/settlement/read-only-transaction';
import {
  FakeReservationClient,
  InMemoryLodgingQuotes,
  otaReservation,
  QUOTE_A,
  storedQuote,
} from '../../../support/settlement/fake-settlement-ports';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeWithDatabase = TEST_DATABASE_URL ? describe : describe.skip;

const RESERVATION_REF = 'RES-IT-002-CONCURRENCIA';
const ROOM_ID = '5f0e8a47-1b2c-4d3e-9f6a-7b8c9d0e1f23';
const SETTLEMENT_ID = 'e7000000-0000-4000-8000-000000000001';
const STAY_ID = 'e8000000-0000-4000-8000-000000000001';
const INVOICE_ID = 'e9000000-0000-4000-8000-000000000001';
// Muy por encima del consecutivo de 006; no se toca invoice_number_counter.
const INVOICE_NUMBER = BigInt('9002000101');
const CALCULATED_AT = new Date('2026-12-22T15:00:00.000Z');
const OTA: SettlementCaller = { kind: 'OTA', otaId: 'booking' };

// Lo que guardaría 007 con la misma reserva y cotización que usa la informativa.
const FINAL: NewSettlement = {
  settlementId: SETTLEMENT_ID,
  stayId: STAY_ID,
  reservationRef: RESERVATION_REF,
  roomId: ROOM_ID,
  categoryRoom: 'DOBLE',
  checkInDate: '2026-12-20',
  checkOutDate: '2026-12-23',
  quoteId: QUOTE_A,
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
};

const BREAKDOWN = {
  baseLodgingAmount: '700000.00',
  dynamicAdjustmentAmount: '50000.00',
  lodgingAmount: '750000.00',
  otaCommissionPercentage: '15.00',
  otaCommissionAmount: '112500.00',
  netIncome: '637500.00',
};

const INFORMATIVE: SettlementQueryResult = {
  settlementType: 'INFORMATIVE',
  reservationRef: RESERVATION_REF,
  roomId: ROOM_ID,
  categoryRoom: null,
  channel: 'OTA',
  otaId: 'booking',
  currency: 'COP',
  breakdown: BREAKDOWN,
  invoice: null,
  generatedAt: CALCULATED_AT,
};

const EXPECTED_INVOICE = {
  invoiceId: INVOICE_ID,
  invoiceNumber: 9002000101,
  issuedAt: expect.any(Date),
  vatRateApplied: '19.00',
  vatAmount: '142500.00',
  totalAmount: '892500.00',
  status: 'ISSUED',
};

// Factura con la misma forma que guarda 006 (CHECK de la migración create_invoice).
function invoiceData() {
  return {
    id: INVOICE_ID,
    invoiceNumber: INVOICE_NUMBER,
    status: 'ISSUED',
    settlementId: SETTLEMENT_ID,
    stayId: STAY_ID,
    sourceEventId: FINAL.sourceEventId,
    reservationRef: RESERVATION_REF,
    channel: 'OTA',
    otaId: 'booking',
    customerName: 'Ana Pérez',
    customerTaxId: '1020304050',
    currency: 'COP',
    lodgingAmount: '750000.00',
    otaCommissionAmount: '112500.00',
    netIncome: '637500.00',
    vatRateApplied: '19.00',
    vatAmount: '142500.00',
    totalAmount: '892500.00',
  };
}

// Una transacción de escritura que se queda abierta hasta que la prueba la suelte, para
// consultar mientras el guardado está en curso.
function openWrite(
  prisma: PrismaService,
  write: (tx: Prisma.TransactionClient) => Promise<unknown>,
) {
  let release!: () => void;
  let written!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const done = new Promise<void>((resolve) => (written = resolve));
  const committed = prisma.$transaction(
    async (tx) => {
      await write(tx);
      written();
      await gate;
    },
    { timeout: 30_000 },
  );
  return { written: done, commit: async () => (release(), committed) };
}

function settlementOf(result: GetSettlementResult): SettlementQueryResult {
  if (result.kind !== 'SINGLE') throw new Error('Se esperaba una sola liquidación');
  return result.settlement;
}

describeWithDatabase('Consulta de liquidación durante el check-out (PostgreSQL real)', () => {
  let prisma: PrismaService;
  let service: GetSettlementService;

  async function cleanUp(): Promise<void> {
    await prisma.invoice.deleteMany({ where: { reservationRef: RESERVATION_REF } });
    await prisma.settlement.deleteMany({ where: { reservationRef: RESERVATION_REF } });
  }

  const asModule1 = async () =>
    settlementOf(
      await service.execute(
        { reservationRef: RESERVATION_REF, roomId: ROOM_ID },
        INTERNAL_SETTLEMENT_CALLER,
      ),
    );

  // La OTA ve la colección de sus Final o SETTLEMENT_NOT_FOUND.
  const asOta = async (): Promise<readonly SettlementQueryResult[] | 'NOT_FOUND'> => {
    try {
      const result = await service.execute({ reservationRef: RESERVATION_REF }, OTA);
      if (result.kind !== 'COLLECTION') throw new Error('Se esperaba la colección de la OTA');
      return result.settlements;
    } catch (error) {
      if (error instanceof SettlementNotFoundError) return 'NOT_FOUND';
      throw error;
    }
  };

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    prisma = new PrismaService();
    await prisma.$connect();
    service = new GetSettlementService(
      new PrismaSettlementQueryAdapter(prisma),
      new PrismaSettlementInvoiceQueryAdapter(prisma),
      new PrismaSettlementRepository(prisma),
      new FakeReservationClient(otaReservation({ reservationRef: RESERVATION_REF })),
      new InMemoryLodgingQuotes([storedQuote(QUOTE_A, ROOM_ID)]),
      () => CALCULATED_AT,
    );
  });

  beforeEach(cleanUp);

  afterAll(async () => {
    await cleanUp();
    await prisma.$disconnect();
  });

  it('las lecturas de 002 corren en una transacción que PostgreSQL marca como de solo lectura', async () => {
    const readOnly = await readOnlyTransaction(prisma, async (tx) => {
      const rows = await tx.$queryRaw<
        Array<{ transaction_read_only: string }>
      >`SHOW transaction_read_only`;
      return rows[0].transaction_read_only;
    });

    expect(readOnly).toBe('on');
  });

  it('consultar como Módulo 1 y como OTA no cambia ninguna liquidación ni factura (FR-004, BR-001)', async () => {
    await prisma.settlement.create({ data: SettlementMapper.toCreateInput(FINAL) });
    await prisma.invoice.create({ data: invoiceData() });
    const snapshot = async () => ({
      settlements: await prisma.settlement.findMany({ where: { reservationRef: RESERVATION_REF } }),
      invoices: await prisma.invoice.findMany({ where: { reservationRef: RESERVATION_REF } }),
    });
    const before = await snapshot();

    for (let round = 0; round < 3; round += 1) {
      await asModule1();
      await asOta();
    }

    expect(await snapshot()).toEqual(before);
  });

  it('una Final que se está guardando no se ve: Módulo 1 recibe la informativa y la OTA nada; al confirmarse, la Final', async () => {
    const write = openWrite(prisma, (tx) =>
      tx.settlement.create({ data: SettlementMapper.toCreateInput(FINAL) }),
    );
    await write.written;

    try {
      await expect(asModule1()).resolves.toEqual(INFORMATIVE);
      await expect(asOta()).resolves.toBe('NOT_FOUND');
    } finally {
      await write.commit();
    }

    const final = await asModule1();
    expect(final).toMatchObject({
      settlementType: 'FINAL',
      categoryRoom: 'DOBLE',
      breakdown: BREAKDOWN,
      invoice: null,
    });
    await expect(asOta()).resolves.toEqual([final]);
  });

  it('una factura que se está guardando no se ve: la Final sale con invoice null; al confirmarse, con la factura completa', async () => {
    await prisma.settlement.create({ data: SettlementMapper.toCreateInput(FINAL) });
    const write = openWrite(prisma, (tx) => tx.invoice.create({ data: invoiceData() }));
    await write.written;

    try {
      await expect(asModule1()).resolves.toMatchObject({ settlementType: 'FINAL', invoice: null });
      const [forOta] = (await asOta()) as SettlementQueryResult[];
      expect(forOta.invoice).toBeNull();
    } finally {
      await write.commit();
    }

    await expect(asModule1()).resolves.toMatchObject({ invoice: EXPECTED_INVOICE });
    const [forOta] = (await asOta()) as SettlementQueryResult[];
    expect(forOta.invoice).toEqual(EXPECTED_INVOICE);
  });

  it('consultas concurrentes con el check-out: cada respuesta es un resultado permitido y completo, nunca una mezcla (NFR-002)', async () => {
    const module1Seen: SettlementQueryResult[] = [];
    const otaSeen: Array<readonly SettlementQueryResult[] | 'NOT_FOUND'> = [];
    let checkoutDone = false;

    const reader = async (): Promise<void> => {
      // Sigue leyendo un poco después del check-out para ver también el estado final.
      let extra = 0;
      while (!checkoutDone || extra < 3) {
        if (checkoutDone) extra += 1;
        module1Seen.push(await asModule1());
        otaSeen.push(await asOta());
      }
    };
    const checkout = async (): Promise<void> => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      // 007 guarda la Final; luego 006 la factura, en otra transacción.
      await prisma.settlement.create({ data: SettlementMapper.toCreateInput(FINAL) });
      await new Promise((resolve) => setTimeout(resolve, 30));
      await prisma.invoice.create({ data: invoiceData() });
      checkoutDone = true;
    };

    await Promise.all([reader(), reader(), checkout()]);

    const stored = await prisma.settlement.findUniqueOrThrow({ where: { id: SETTLEMENT_ID } });
    const finalWithout: SettlementQueryResult = {
      settlementType: 'FINAL',
      reservationRef: RESERVATION_REF,
      roomId: ROOM_ID,
      categoryRoom: 'DOBLE',
      channel: 'OTA',
      otaId: 'booking',
      currency: 'COP',
      breakdown: BREAKDOWN,
      invoice: null,
      generatedAt: stored.generatedAt,
    };
    const finalWith = { ...finalWithout, invoice: EXPECTED_INVOICE };
    const isFinal = (item: SettlementQueryResult): boolean => {
      try {
        expect(item).toEqual(item.invoice === null ? finalWithout : finalWith);
        return true;
      } catch {
        return false;
      }
    };

    // Módulo 1: la informativa completa o la Final completa (con o sin factura).
    for (const item of module1Seen) {
      if (item.settlementType === 'INFORMATIVE') expect(item).toEqual(INFORMATIVE);
      else expect(isFinal(item)).toBe(true);
    }
    // OTA: nada, o su única Final completa (con o sin factura). Nunca una informativa.
    for (const seen of otaSeen) {
      if (seen === 'NOT_FOUND') continue;
      expect(seen).toHaveLength(1);
      expect(seen[0].settlementType).toBe('FINAL');
      expect(isFinal(seen[0])).toBe(true);
    }
    // Una vez terminado el check-out, los dos ven la Final con su factura.
    expect(module1Seen[module1Seen.length - 1]).toEqual(finalWith);
    expect(otaSeen[otaSeen.length - 1]).toEqual([finalWith]);
  }, 60_000);
});
