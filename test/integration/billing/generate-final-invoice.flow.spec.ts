// Feature 006 · Generar factura final (T017, T030, T032; HU1 y HU2 de punta a punta)
// Flujo real de generate tal como lo invocará 010: 007 real (cliente HTTP de Módulo 2 contra
// un servidor simulado y liquidaciones en PostgreSQL) + 001 real (IVA) + facturas en
// PostgreSQL. Las cotizaciones vienen de un doble en memoria (como en el flujo de 007) y el
// IVA de un repositorio en memoria, para no depender de tablas que otras suites modifican.
// Necesita TEST_DATABASE_URL (ver prisma-invoice-issuance.repository.spec.ts); sin ella se omite.
import { HttpModule } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { GenerateFinalInvoiceService } from '../../../src/application/services/billing/generate-final-invoice.service';
import { GetCurrentVatRateService } from '../../../src/application/services/billing/get-current-vat-rate.service';
import { GenerateSettlementService } from '../../../src/application/services/settlement/generate-settlement.service';
import { VatRate } from '../../../src/domain/model/billing/vat-rate';
import { VatRateValue } from '../../../src/domain/model/billing/vat-rate-value.vo';
import { GenerateFinalInvoiceResult } from '../../../src/domain/ports/in/billing/generate-final-invoice.use-case';
import { Module2ReservationClient } from '../../../src/infrastructure/adapters/out/http/module2-reservation.client';
import { PrismaService } from '../../../src/infrastructure/adapters/out/persistence/prisma.service';
import { PrismaInvoiceIssuanceRepository } from '../../../src/infrastructure/adapters/out/persistence/repositories/billing/prisma-invoice-issuance.repository';
import { PrismaSettlementRepository } from '../../../src/infrastructure/adapters/out/persistence/repositories/settlement/prisma-settlement.repository';
import {
  invoiceCommand,
  QUOTE_ID,
  RESERVATION_REF,
} from '../../support/billing/fake-invoice-ports';
import { InMemoryVatRateRepository } from '../../support/billing/in-memory-vat-rate.repository';
import {
  BILLING_TEST_LOCK_TIMEOUT_MS,
  lockBillingTestDatabase,
} from '../../support/database/billing-test-database-lock';
import { Module1HttpFixture } from '../../support/pricing/module1-http-fixture';
import { InMemoryLodgingQuotes } from '../../support/settlement/fake-settlement-ports';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeWithDatabase = TEST_DATABASE_URL ? describe : describe.skip;

const STAY_OTA = '63000000-0000-4000-8000-000000000001';
const STAY_DIRECT = '63000000-0000-4000-8000-000000000002';
const STAY_NO_CUSTOMER = '63000000-0000-4000-8000-000000000003';
const STAY_RACE = '63000000-0000-4000-8000-000000000004';
const STAY_NO_VAT = '63000000-0000-4000-8000-000000000005';
const STAY_DOWN = '63000000-0000-4000-8000-000000000006';
const OWN_STAYS = [STAY_OTA, STAY_DIRECT, STAY_NO_CUSTOMER, STAY_RACE, STAY_NO_VAT, STAY_DOWN];

// "Sin demoras perceptibles" (NFR-002): el mismo objetivo que 007 para el check-out.
const ISSUANCE_BUDGET_MS = 800;

const OTA_RESERVATION = {
  reservationRef: RESERVATION_REF,
  quoteIds: [QUOTE_ID],
  channel: 'OTA',
  otaId: 'booking',
  otaConfirmationCode: 'BKG-88421',
  otaCommissionPercentage: 15,
};
const DIRECT_RESERVATION = { reservationRef: RESERVATION_REF, quoteIds: [QUOTE_ID], channel: null };

function vatRateOf(value: string): VatRate {
  return new VatRate(VatRateValue.of(value), 'admin', new Date());
}

function issuedOf(result: GenerateFinalInvoiceResult) {
  if (result.status !== 'ISSUED') throw new Error(`se esperaba ISSUED, llegó ${result.status}`);
  return result.invoice;
}

describeWithDatabase(
  'GenerateFinalInvoice de punta a punta (007 + Módulo 2 simulado + PostgreSQL)',
  () => {
    let prisma: PrismaService;
    let fixture: Module1HttpFixture;
    let moduleRef: TestingModule;
    let vatRates: InMemoryVatRateRepository;
    let service: GenerateFinalInvoiceService;
    let unlockDatabase: () => Promise<void>;

    async function counter(): Promise<number> {
      const row = await prisma.invoiceNumberCounter.findUniqueOrThrow({ where: { id: 1 } });
      return Number(row.lastNumber);
    }

    async function cleanUp(): Promise<void> {
      await prisma.invoice.deleteMany({ where: { stayId: { in: OWN_STAYS } } });
      await prisma.settlement.deleteMany({ where: { stayId: { in: OWN_STAYS } } });
    }

    beforeAll(async () => {
      // El repositorio de emisión de 006 también emite contra el mismo consecutivo: se turnan.
      unlockDatabase = await lockBillingTestDatabase(TEST_DATABASE_URL!);
      process.env.DATABASE_URL = TEST_DATABASE_URL;
      prisma = new PrismaService();
      await prisma.$connect();
    }, BILLING_TEST_LOCK_TIMEOUT_MS);

    beforeEach(async () => {
      await cleanUp();
      fixture = new Module1HttpFixture();
      await fixture.start();
      fixture.setReply({ status: 200, body: OTA_RESERVATION });
      moduleRef = await Test.createTestingModule({
        imports: [HttpModule.register({})],
        providers: [
          Module2ReservationClient,
          {
            provide: ConfigService,
            useValue: {
              get: (name: string) =>
                name === 'MODULE2_BASE_URL'
                  ? fixture.baseUrl
                  : name === 'MODULE2_TIMEOUT_MS'
                    ? '500'
                    : undefined,
            },
          },
        ],
      }).compile();
      vatRates = new InMemoryVatRateRepository();
      vatRates.current = vatRateOf('19.00');
      service = new GenerateFinalInvoiceService(
        new GenerateSettlementService(
          moduleRef.get(Module2ReservationClient),
          new InMemoryLodgingQuotes(),
          new PrismaSettlementRepository(prisma),
        ),
        new GetCurrentVatRateService(vatRates),
        new PrismaInvoiceIssuanceRepository(prisma),
      );
    });

    afterEach(async () => {
      await moduleRef?.close();
      await fixture?.stop();
    });

    afterAll(async () => {
      await cleanUp();
      await prisma?.$disconnect();
      await unlockDatabase?.();
    });

    it('OTA: liquida, emite con el siguiente número y el total es hospedaje + IVA (HU1 esc. 2, HU2 esc. 2)', async () => {
      const before = await counter();

      const invoice = issuedOf(await service.generate(invoiceCommand({ stayId: STAY_OTA })));

      const settlement = await prisma.settlement.findUniqueOrThrow({ where: { stayId: STAY_OTA } });
      expect(invoice).toMatchObject({
        invoiceNumber: before + 1,
        status: 'ISSUED',
        settlementId: settlement.id,
        channel: 'OTA',
        otaId: 'booking',
        lodgingAmount: '750000.00',
        otaCommissionAmount: '112500.00',
        netIncome: '637500.00',
        vatRateApplied: '19.00',
        vatAmount: '142500.00',
        totalAmount: '892500.00',
      });
      await expect(prisma.invoice.count({ where: { stayId: STAY_OTA } })).resolves.toBe(1);
    });

    it('canal directo: comisión 0.00 y neto = hospedaje (HU1 esc. 1, HU2 esc. 1)', async () => {
      fixture.setReply({ status: 200, body: DIRECT_RESERVATION });

      const invoice = issuedOf(await service.generate(invoiceCommand({ stayId: STAY_DIRECT })));

      expect(invoice).toMatchObject({
        channel: 'DIRECT',
        otaId: null,
        otaCommissionAmount: '0.00',
        netIncome: '750000.00',
        totalAmount: '892500.00',
      });
    });

    it('reenvío con el IVA cambiado: misma factura y número, sin consultar Módulo 2 ni consumir número (HU1 esc. 3)', async () => {
      const original = issuedOf(await service.generate(invoiceCommand({ stayId: STAY_OTA })));
      const afterFirst = await counter();
      const requestsAfterFirst = fixture.requests;
      vatRates.current = vatRateOf('5.00');

      const resent = issuedOf(await service.generate(invoiceCommand({ stayId: STAY_OTA })));

      expect(resent).toEqual(original);
      expect(resent.vatRateApplied).toBe('19.00');
      expect(await counter()).toBe(afterFirst);
      expect(fixture.requests).toBe(requestsAfterFirst);
    });

    it('tres entregas simultáneas del mismo check-out → una liquidación, una factura, un número', async () => {
      const before = await counter();
      const command = invoiceCommand({ stayId: STAY_RACE });

      const results = await Promise.all([1, 2, 3].map(() => service.generate(command)));

      const invoices = results.map(issuedOf);
      expect(new Set(invoices.map((invoice) => invoice.invoiceId)).size).toBe(1);
      expect(invoices[0].invoiceNumber).toBe(before + 1);
      expect(await counter()).toBe(before + 1);
      await expect(prisma.settlement.count({ where: { stayId: STAY_RACE } })).resolves.toBe(1);
      await expect(prisma.invoice.count({ where: { stayId: STAY_RACE } })).resolves.toBe(1);
    });

    it('sin datos tributarios: queda la liquidación, sin factura ni número (BR-004)', async () => {
      const before = await counter();

      const result = await service.generate(
        invoiceCommand({ stayId: STAY_NO_CUSTOMER, billingCustomer: { name: 'Ana Pérez' } }),
      );

      expect(result).toEqual({ status: 'NOT_ISSUED', reason: 'BILLING_CUSTOMER_DATA_MISSING' });
      await expect(prisma.settlement.count({ where: { stayId: STAY_NO_CUSTOMER } })).resolves.toBe(
        1,
      );
      await expect(prisma.invoice.count({ where: { stayId: STAY_NO_CUSTOMER } })).resolves.toBe(0);
      expect(await counter()).toBe(before);
    });

    it('IVA nunca configurado: VAT_RATE_NOT_CONFIGURED, queda la liquidación, sin factura ni número', async () => {
      vatRates.current = null;
      const before = await counter();

      await expect(service.generate(invoiceCommand({ stayId: STAY_NO_VAT }))).rejects.toMatchObject(
        {
          errorCode: 'VAT_RATE_NOT_CONFIGURED',
        },
      );
      await expect(prisma.settlement.count({ where: { stayId: STAY_NO_VAT } })).resolves.toBe(1);
      await expect(prisma.invoice.count({ where: { stayId: STAY_NO_VAT } })).resolves.toBe(0);
      expect(await counter()).toBe(before);
    });

    it('el reintento después de configurar el IVA emite la factura sobre la liquidación ya guardada', async () => {
      vatRates.current = null;
      await expect(service.generate(invoiceCommand({ stayId: STAY_NO_VAT }))).rejects.toBeDefined();
      const settlement = await prisma.settlement.findUniqueOrThrow({
        where: { stayId: STAY_NO_VAT },
      });
      vatRates.current = vatRateOf('19.00');

      const invoice = issuedOf(await service.generate(invoiceCommand({ stayId: STAY_NO_VAT })));

      expect(invoice.settlementId).toBe(settlement.id);
      await expect(prisma.settlement.count({ where: { stayId: STAY_NO_VAT } })).resolves.toBe(1);
    });

    it('Módulo 2 caído: MODULE2_UNAVAILABLE sin liquidación, factura ni número', async () => {
      fixture.setReply({ status: 503, body: {} });
      const before = await counter();

      await expect(service.generate(invoiceCommand({ stayId: STAY_DOWN }))).rejects.toMatchObject({
        errorCode: 'MODULE2_UNAVAILABLE',
      });
      await expect(prisma.settlement.count({ where: { stayId: STAY_DOWN } })).resolves.toBe(0);
      await expect(prisma.invoice.count({ where: { stayId: STAY_DOWN } })).resolves.toBe(0);
      expect(await counter()).toBe(before);
    });

    it(`liquidación + factura caben en ${ISSUANCE_BUDGET_MS} ms con Módulo 2 tardando 200 ms (NFR-002)`, async () => {
      fixture.setReply({ status: 200, body: OTA_RESERVATION, delayMs: 200 });
      const startedAt = performance.now();

      await service.generate(invoiceCommand({ stayId: STAY_OTA }));

      expect(performance.now() - startedAt).toBeLessThan(ISSUANCE_BUDGET_MS);
    });
  },
);
