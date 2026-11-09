// Feature 006 · Generar factura final (T017, T025, T030, T031, T032)
// Archivo de acceso a datos real contra PostgreSQL. Necesita una base ya migrada:
//   TEST_DATABASE_URL=... npx prisma migrate deploy   (con DATABASE_URL apuntando a ella)
//   TEST_DATABASE_URL=... npm test
// Sin TEST_DATABASE_URL estas pruebas se omiten.
//
// El consecutivo es global, así que estas pruebas no suponen números absolutos: comparan
// con el valor del contador antes de empezar. Solo borran sus propias facturas y
// liquidaciones; el contador nunca se reinicia (como en producción).
import { BillingCustomer } from '../../../../src/domain/model/billing/billing-customer';
import { Invoice, InvoiceDraft } from '../../../../src/domain/model/billing/invoice';
import { InvoiceBreakdown } from '../../../../src/domain/model/billing/invoice-breakdown';
import { VatRateValue } from '../../../../src/domain/model/billing/vat-rate-value.vo';
import { NewSettlement } from '../../../../src/domain/model/settlement/settlement';
import { SettlementMapper } from '../../../../src/infrastructure/adapters/out/persistence/mappers/settlement/settlement.mapper';
import { PrismaService } from '../../../../src/infrastructure/adapters/out/persistence/prisma.service';
import { PrismaInvoiceIssuanceRepository } from '../../../../src/infrastructure/adapters/out/persistence/repositories/billing/prisma-invoice-issuance.repository';
import {
  INVOICE_PUBLICATION_LOCK_KEY,
  INVOICE_PUBLICATION_LOCK_NAMESPACE,
} from '../../../../src/infrastructure/adapters/out/persistence/repositories/billing/invoice-publication-lock';
import {
  BILLING_TEST_LOCK_TIMEOUT_MS,
  lockBillingTestDatabase,
} from '../../../support/database/billing-test-database-lock';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeWithDatabase = TEST_DATABASE_URL ? describe : describe.skip;

const STAYS = Array.from(
  { length: 8 },
  (_, index) => `60000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
);
const [STAY_DIRECT, STAY_OTA, STAY_RACE, STAY_ROLLBACK, ...STAYS_SEQUENCE] = STAYS;
const MISSING_SETTLEMENT = '6f000000-0000-4000-8000-000000000099';

function settlementIdOf(stayId: string): string {
  return stayId.replace(/^60/, '61');
}

let nextInvoice = 0;
function invoiceId(): string {
  nextInvoice += 1;
  return `62000000-0000-4000-8000-${String(nextInvoice).padStart(12, '0')}`;
}

function settlement(stayId: string, ota = false): NewSettlement {
  return {
    settlementId: settlementIdOf(stayId),
    stayId,
    reservationRef: 'RES-IT-006',
    roomId: '5f0e8a47-1b2c-4d3e-9f6a-7b8c9d0e1f23',
    categoryRoom: 'DOBLE',
    checkInDate: '2026-12-20',
    checkOutDate: '2026-12-23',
    quoteId: 'a1f2c3d4-e5b6-4789-8a9b-0c1d2e3f4a5b',
    channel: ota ? 'OTA' : 'DIRECT',
    otaId: ota ? 'booking' : null,
    otaConfirmationCode: ota ? 'BKG-88421' : null,
    otaCommissionPercentage: ota ? '15.00' : null,
    currency: 'COP',
    lodgingAmount: '750000.00',
    baseLodgingAmount: '700000.00',
    dynamicAdjustmentAmount: '50000.00',
    otaCommissionAmount: ota ? '112500.00' : '0.00',
    netIncome: ota ? '637500.00' : '750000.00',
    sourceEventId: '9b1f6d3e-2c4a-4f7b-8e5d-3a1c0b9d8e72',
  };
}

function draft(source: NewSettlement, overrides: Partial<InvoiceDraft> = {}): InvoiceDraft {
  return {
    ...Invoice.prepare({
      invoiceId: invoiceId(),
      sourceEventId: source.sourceEventId,
      settlement: source,
      customer: BillingCustomer.restore('Comercializadora Andina S.A.S.', '900123456-7'),
      amounts: InvoiceBreakdown.calculate(source, VatRateValue.of('19.00')),
    }),
    ...overrides,
  };
}

describeWithDatabase('PrismaInvoiceIssuanceRepository (PostgreSQL real)', () => {
  let prisma: PrismaService;
  let repository: PrismaInvoiceIssuanceRepository;
  let unlockDatabase: () => Promise<void>;

  async function counter(): Promise<number> {
    const row = await prisma.invoiceNumberCounter.findUniqueOrThrow({ where: { id: 1 } });
    return Number(row.lastNumber);
  }

  async function cleanUp(): Promise<void> {
    await prisma.invoice.deleteMany({ where: { stayId: { in: STAYS } } });
    await prisma.settlement.deleteMany({ where: { stayId: { in: STAYS } } });
  }

  beforeAll(async () => {
    // El flujo de 006 también emite contra el mismo consecutivo: se turnan.
    unlockDatabase = await lockBillingTestDatabase(TEST_DATABASE_URL!);
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    prisma = new PrismaService();
    await prisma.$connect();
    repository = new PrismaInvoiceIssuanceRepository(prisma);
  }, BILLING_TEST_LOCK_TIMEOUT_MS);

  beforeEach(async () => {
    await cleanUp();
    for (const stayId of STAYS) {
      await prisma.settlement.create({
        data: SettlementMapper.toCreateInput(settlement(stayId, stayId === STAY_OTA)),
      });
    }
  });

  afterAll(async () => {
    await cleanUp();
    await prisma?.$disconnect();
    await unlockDatabase?.();
  });

  it('emite con el siguiente número y la relee igual, con issuedAt de la base de datos', async () => {
    const before = await counter();
    const toIssue = draft(settlement(STAY_DIRECT));

    const issued = await repository.issueIfAbsent(toIssue);
    const read = await repository.findByStayId(STAY_DIRECT);

    expect(issued.invoiceNumber).toBe(before + 1);
    expect(await counter()).toBe(before + 1);
    expect(read).toEqual(issued);
    expect(issued).toEqual(expect.objectContaining({ ...toIssue, status: 'ISSUED' }));
    expect(issued.issuedAt).toBeInstanceOf(Date);
  });

  it('espera el corte compartido de 008 antes de asignar número y fecha de emisión', async () => {
    let releaseCutoff!: () => void;
    let markLocked!: () => void;
    const release = new Promise<void>((resolve) => {
      releaseCutoff = resolve;
    });
    const locked = new Promise<void>((resolve) => {
      markLocked = resolve;
    });
    const cutoff = prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SET TRANSACTION READ ONLY`;
        await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock_shared(${INVOICE_PUBLICATION_LOCK_NAMESPACE}::int, ${INVOICE_PUBLICATION_LOCK_KEY}::int)`;
        markLocked();
        await release;
      },
      { timeout: 15_000 },
    );
    let emission: Promise<Invoice> | undefined;
    try {
      await locked;
      const before = await counter();
      emission = repository.issueIfAbsent(draft(settlement(STAY_DIRECT)));
      const deadline = Date.now() + 4_000;
      let waiting = false;
      while (Date.now() < deadline) {
        const [row] = await prisma.$queryRaw<{ waiting: boolean }[]>`
          SELECT EXISTS(SELECT 1 FROM pg_locks WHERE locktype = 'advisory'
            AND classid = ${INVOICE_PUBLICATION_LOCK_NAMESPACE}::oid
            AND objid = ${INVOICE_PUBLICATION_LOCK_KEY}::oid AND NOT granted) AS waiting`;
        if (row.waiting) {
          waiting = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(waiting).toBe(true);
      expect(await counter()).toBe(before);
      releaseCutoff();
      await cutoff;
      expect((await emission).invoiceNumber).toBe(before + 1);
    } finally {
      releaseCutoff();
      await cutoff;
      await emission;
    }
  }, 20_000);

  it('canal OTA: importes, canal y cliente se leen exactamente como se emitieron (T025)', async () => {
    const issued = await repository.issueIfAbsent(draft(settlement(STAY_OTA, true)));
    const read = await repository.findByStayId(STAY_OTA);

    expect(read).toEqual(
      expect.objectContaining({
        invoiceNumber: issued.invoiceNumber,
        channel: 'OTA',
        otaId: 'booking',
        lodgingAmount: '750000.00',
        otaCommissionAmount: '112500.00',
        netIncome: '637500.00',
        vatRateApplied: '19.00',
        vatAmount: '142500.00',
        totalAmount: '892500.00',
      }),
    );
    expect(read?.customer).toEqual(issued.customer);
  });

  it('una estancia sin factura → null', async () => {
    await expect(repository.findByStayId(STAY_DIRECT)).resolves.toBeNull();
  });

  it('reenvío: devuelve la factura existente sin consumir número (FR-007)', async () => {
    const first = await repository.issueIfAbsent(draft(settlement(STAY_DIRECT)));
    const afterFirst = await counter();

    const again = await repository.issueIfAbsent(draft(settlement(STAY_DIRECT)));

    expect(again).toEqual(first);
    expect(await counter()).toBe(afterFirst);
  });

  it('dos emisiones simultáneas de la misma estancia → una sola factura y un solo número (T030)', async () => {
    const before = await counter();

    const results = await Promise.all(
      Array.from({ length: 5 }, () => repository.issueIfAbsent(draft(settlement(STAY_RACE)))),
    );

    const ids = new Set(results.map((invoice) => invoice.invoiceId));
    expect(ids.size).toBe(1);
    expect(results.every((invoice) => invoice.invoiceNumber === before + 1)).toBe(true);
    expect(await counter()).toBe(before + 1);
    expect(await prisma.invoice.count({ where: { stayId: STAY_RACE } })).toBe(1);
  });

  it('estancias distintas en paralelo → números únicos y consecutivos, en el orden de emisión (T031)', async () => {
    const before = await counter();

    const results = await Promise.all(
      STAYS_SEQUENCE.map((stayId) => repository.issueIfAbsent(draft(settlement(stayId)))),
    );

    const numbers = results.map((invoice) => invoice.invoiceNumber).sort((a, b) => a - b);
    expect(numbers).toEqual(STAYS_SEQUENCE.map((_, index) => before + index + 1));
    expect(await counter()).toBe(before + STAYS_SEQUENCE.length);
    // issued_at (clock_timestamp) sigue el mismo orden que el número.
    const byNumber = [...results].sort((a, b) => a.invoiceNumber - b.invoiceNumber);
    const times = byNumber.map((invoice) => invoice.issuedAt.getTime());
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  it('si la inserción falla, el contador no avanza y la próxima factura usa el número siguiente (T032)', async () => {
    const before = await counter();

    // La liquidación no existe: la FK rechaza la factura después de incrementar el contador.
    await expect(
      repository.issueIfAbsent(
        draft(settlement(STAY_ROLLBACK), { settlementId: MISSING_SETTLEMENT }),
      ),
    ).rejects.toThrow();
    expect(await counter()).toBe(before);
    await expect(repository.findByStayId(STAY_ROLLBACK)).resolves.toBeNull();

    const next = await repository.issueIfAbsent(draft(settlement(STAY_ROLLBACK)));
    expect(next.invoiceNumber).toBe(before + 1);
  });

  it('la base rechaza una factura cuyo total no es hospedaje + IVA (CHECK)', async () => {
    const before = await counter();
    const broken = { ...draft(settlement(STAY_DIRECT)), totalAmount: '750000.00' };

    await expect(repository.issueIfAbsent(broken)).rejects.toThrow();
    expect(await counter()).toBe(before);
  });
});
