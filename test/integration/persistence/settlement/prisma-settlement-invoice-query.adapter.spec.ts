// Feature 002 · Consultar liquidación (T006)
// Lectura real de la factura de una liquidación contra PostgreSQL. Necesita una base ya
// migrada (ver prisma-settlement-query.adapter.spec.ts). Sin TEST_DATABASE_URL se omite.
// Crea sus propias liquidaciones y facturas, con números de factura muy altos que el
// consecutivo de 006 no alcanza, y no toca invoice_number_counter.
import { NewSettlement } from '../../../../src/domain/model/settlement/settlement';
import { SettlementMapper } from '../../../../src/infrastructure/adapters/out/persistence/mappers/settlement/settlement.mapper';
import { PrismaService } from '../../../../src/infrastructure/adapters/out/persistence/prisma.service';
import { PrismaSettlementInvoiceQueryAdapter } from '../../../../src/infrastructure/adapters/out/persistence/repositories/settlement/prisma-settlement-invoice-query.adapter';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeWithDatabase = TEST_DATABASE_URL ? describe : describe.skip;

const RESERVATION_REF = 'RES-IT-002-FACTURA';
const SETTLED_WITH_INVOICE = 'e4000000-0000-4000-8000-000000000001';
const SETTLED_WITHOUT_INVOICE = 'e4000000-0000-4000-8000-000000000002';
const STAY_WITH_INVOICE = 'e5000000-0000-4000-8000-000000000001';
const STAY_WITHOUT_INVOICE = 'e5000000-0000-4000-8000-000000000002';
const INVOICE_ID = 'e6000000-0000-4000-8000-000000000001';
const INVOICE_NUMBER = BigInt('9002000001');

function settlement(settlementId: string, stayId: string, roomId: string): NewSettlement {
  return {
    settlementId,
    stayId,
    reservationRef: RESERVATION_REF,
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
  };
}

describeWithDatabase('PrismaSettlementInvoiceQueryAdapter (PostgreSQL real)', () => {
  let prisma: PrismaService;
  let adapter: PrismaSettlementInvoiceQueryAdapter;

  async function cleanUp(): Promise<void> {
    await prisma.invoice.deleteMany({ where: { reservationRef: RESERVATION_REF } });
    await prisma.settlement.deleteMany({ where: { reservationRef: RESERVATION_REF } });
  }

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    prisma = new PrismaService();
    await prisma.$connect();
    adapter = new PrismaSettlementInvoiceQueryAdapter(prisma);
    await cleanUp();

    await prisma.settlement.create({
      data: SettlementMapper.toCreateInput(
        settlement(SETTLED_WITH_INVOICE, STAY_WITH_INVOICE, '5f0e8a47-1b2c-4d3e-9f6a-7b8c9d0e1f23'),
      ),
    });
    await prisma.settlement.create({
      data: SettlementMapper.toCreateInput(
        settlement(
          SETTLED_WITHOUT_INVOICE,
          STAY_WITHOUT_INVOICE,
          '6a1f9b58-2c3d-4e4f-8a7b-8c9d0e1f2a34',
        ),
      ),
    });
    // Factura con la misma forma que guarda 006 (CHECK de la migración create_invoice).
    await prisma.invoice.create({
      data: {
        id: INVOICE_ID,
        invoiceNumber: INVOICE_NUMBER,
        status: 'ISSUED',
        settlementId: SETTLED_WITH_INVOICE,
        stayId: STAY_WITH_INVOICE,
        sourceEventId: '9b1f6d3e-2c4a-4f7b-8e5d-3a1c0b9d8e72',
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
      },
    });
  });

  afterAll(async () => {
    await cleanUp();
    await prisma.$disconnect();
  });

  it('devuelve el subconjunto del contrato con los tipos del contrato (FR-003)', async () => {
    const stored = await prisma.invoice.findUniqueOrThrow({ where: { id: INVOICE_ID } });

    const invoice = await adapter.findBySettlementId(SETTLED_WITH_INVOICE);

    expect(invoice).toEqual({
      invoiceId: INVOICE_ID,
      invoiceNumber: 9002000001,
      issuedAt: stored.issuedAt,
      vatRateApplied: '19.00',
      vatAmount: '142500.00',
      totalAmount: '892500.00',
      status: 'ISSUED',
    });
    expect(typeof invoice?.invoiceNumber).toBe('number');
  });

  it('nunca trae los datos tributarios del cliente ni otros campos de la factura (FR-007)', async () => {
    const invoice = await adapter.findBySettlementId(SETTLED_WITH_INVOICE);

    expect(Object.keys(invoice ?? {}).sort()).toEqual([
      'invoiceId',
      'invoiceNumber',
      'issuedAt',
      'status',
      'totalAmount',
      'vatAmount',
      'vatRateApplied',
    ]);
    expect(JSON.stringify(invoice)).not.toContain('Ana Pérez');
    expect(JSON.stringify(invoice)).not.toContain('1020304050');
  });

  it('una liquidación sin factura emitida → null', async () => {
    await expect(adapter.findBySettlementId(SETTLED_WITHOUT_INVOICE)).resolves.toBeNull();
  });

  it('consultas repetidas devuelven lo mismo y no cambian la factura (FR-004, FR-008)', async () => {
    const before = await prisma.invoice.findUniqueOrThrow({ where: { id: INVOICE_ID } });

    const first = await adapter.findBySettlementId(SETTLED_WITH_INVOICE);
    const second = await adapter.findBySettlementId(SETTLED_WITH_INVOICE);
    const after = await prisma.invoice.findUniqueOrThrow({ where: { id: INVOICE_ID } });

    expect(second).toEqual(first);
    expect(after).toEqual(before);
  });
});
