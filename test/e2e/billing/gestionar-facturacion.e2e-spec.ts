// Feature 008 · Gestionar facturación (T031, T032)
// De punta a punta con PostgreSQL: el check-out genera la liquidación (007, con Módulo 2
// simulado por HTTP) y la factura (006) tal como lo hace 010 al consumir el evento, y luego el
// Administrador busca, abre el detalle y pide el resumen por HTTP con su JWT. Las cotizaciones
// y el IVA vienen de dobles en memoria, como en la E2E del check-out, para no depender de
// tablas que otras suites modifican. La cola de RabbitMQ no interviene: 010 tiene su propia E2E.
// Necesita TEST_DATABASE_URL (base ya migrada); sin ella se omite.
import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../../src/app.module';
import { VatRate } from '../../../src/domain/model/billing/vat-rate';
import { VatRateValue } from '../../../src/domain/model/billing/vat-rate-value.vo';
import {
  GENERATE_FINAL_INVOICE_USE_CASE,
  GenerateFinalInvoiceUseCase,
} from '../../../src/domain/ports/in/billing/generate-final-invoice.use-case';
import { VAT_RATE_REPOSITORY } from '../../../src/domain/ports/out/billing/vat-rate.repository.port';
import { LODGING_QUOTE_QUERY } from '../../../src/domain/ports/out/pricing/lodging-quote-query.port';
import { PrismaService } from '../../../src/infrastructure/adapters/out/persistence/prisma.service';
import { InMemoryVatRateRepository } from '../../support/billing/in-memory-vat-rate.repository';
import {
  BILLING_TEST_LOCK_TIMEOUT_MS,
  lockBillingTestDatabase,
} from '../../support/database/billing-test-database-lock';
import { Module1HttpFixture } from '../../support/pricing/module1-http-fixture';
import {
  InMemoryLodgingQuotes,
  QUOTE_A,
  storedQuote,
} from '../../support/settlement/fake-settlement-ports';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeWithDatabase = TEST_DATABASE_URL ? describe : describe.skip;

const ROOM_ID = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
const OTA_ID = 'ota-e2e-008';
const RES_OTA = 'RES-E2E-008-OTA';
const RES_DIRECT = 'RES-E2E-008-DIRECTA';
const RES_CANCELLED = 'RES-E2E-008-CANCELADA';
const STAYS = [1, 2, 3].map((n) => `68000000-0000-4000-8000-00000000000${n}`);
const EVENTS = [1, 2, 3].map((n) => `69000000-0000-4000-8000-00000000000${n}`);
const CUSTOMER = { name: 'Comercializadora E2E 008 S.A.S.', taxId: '900800008-1' };

// Hoy en Bogotá (YYYY-MM-DD): las facturas se emiten ahora con el reloj de la base de datos.
function todayInBogota(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date());
}

describeWithDatabase(
  'Gestionar facturación de punta a punta (007 + 006 + PostgreSQL + HTTP)',
  () => {
    let app: INestApplication;
    let prisma: PrismaService;
    let moduleTwo: Module1HttpFixture;
    let invoicesUseCase: GenerateFinalInvoiceUseCase;
    let unlockDatabase: () => Promise<void>;
    let adminToken: string;
    let otaToken: string;

    async function cleanUp(): Promise<void> {
      await prisma.invoice.deleteMany({ where: { stayId: { in: STAYS } } });
      await prisma.settlement.deleteMany({ where: { stayId: { in: STAYS } } });
    }

    // El check-out de una habitación tal como lo procesa 010: 006 incluye a 007.
    function checkOut(index: number, reservationRef: string) {
      return invoicesUseCase.generate({
        eventId: EVENTS[index],
        stayId: STAYS[index],
        reservationRef,
        roomId: ROOM_ID,
        categoryRoom: 'DOBLE',
        checkInDate: '2026-12-20',
        checkOutDate: '2026-12-23',
        billingCustomer: { ...CUSTOMER },
      });
    }

    const get = (path: string, query: Record<string, string> = {}, token = adminToken) =>
      request(app.getHttpServer()).get(path).query(query).set('Authorization', `Bearer ${token}`);

    beforeAll(async () => {
      unlockDatabase = await lockBillingTestDatabase(TEST_DATABASE_URL!);
      moduleTwo = new Module1HttpFixture();
      await moduleTwo.start();
      process.env.DATABASE_URL = TEST_DATABASE_URL;
      process.env.MODULE2_BASE_URL = moduleTwo.baseUrl;
      process.env.JWT_SECRET ||= 'secreto-solo-para-pruebas';
      process.env.JWT_EXPIRES_IN_SECONDS ||= '3600';

      const vatRates = new InMemoryVatRateRepository();
      vatRates.current = new VatRate(VatRateValue.of('19.00'), 'admin', new Date());
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(VAT_RATE_REPOSITORY)
        .useValue(vatRates)
        .overrideProvider(LODGING_QUOTE_QUERY)
        .useValue(new InMemoryLodgingQuotes([storedQuote(QUOTE_A, ROOM_ID)]))
        .compile();
      app = moduleRef.createNestApplication();
      await app.init();
      prisma = app.get(PrismaService);
      invoicesUseCase = app.get(GENERATE_FINAL_INVOICE_USE_CASE);
      const jwt = app.get(JwtService);
      adminToken = jwt.sign({ sub: 'f2d3b4a5-6c7d-4e8f-9012-3456789abcde', role: 'Administrador' });
      otaToken = jwt.sign({
        sub: '0b8a4c1e-2d3f-4a5b-8c6d-7e8f9a0b1c2d',
        role: 'OTA',
        otaId: OTA_ID,
      });
      await cleanUp();

      // Check-out de una reserva OTA y de una directa: cada uno deja su liquidación y su factura.
      moduleTwo.setReply({
        status: 200,
        body: {
          reservationRef: RES_OTA,
          quoteIds: [QUOTE_A],
          channel: 'OTA',
          otaId: OTA_ID,
          otaConfirmationCode: 'E2E-008',
          otaCommissionPercentage: 15,
        },
      });
      await checkOut(0, RES_OTA);
      moduleTwo.setReply({
        status: 200,
        body: { reservationRef: RES_DIRECT, quoteIds: [QUOTE_A], channel: null },
      });
      await checkOut(1, RES_DIRECT);
      // Reserva cancelada en Módulo 2 antes del check-out: Módulo 2 ya no la tiene (BR-003).
      moduleTwo.setReply({ status: 404, body: { message: 'Reserva no encontrada' } });
      await expect(checkOut(2, RES_CANCELLED)).rejects.toMatchObject({
        errorCode: 'RESERVATION_NOT_FOUND',
      });
    }, BILLING_TEST_LOCK_TIMEOUT_MS);

    afterAll(async () => {
      if (prisma) await cleanUp();
      await app?.close();
      await moduleTwo?.stop();
      await unlockDatabase?.();
    });

    it('HU1: busca por reserva y devuelve la factura emitida con su número oficial', async () => {
      const stored = await prisma.invoice.findUniqueOrThrow({ where: { stayId: STAYS[0] } });

      const response = await get('/invoices', { reservationRef: RES_OTA });

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        totalItems: 1,
        resultStatus: 'MATCHES',
        items: [
          {
            invoiceId: stored.id,
            invoiceNumber: Number(stored.invoiceNumber),
            issuedAt: stored.issuedAt.toISOString(),
            stayId: STAYS[0],
            reservationRef: RES_OTA,
            channel: 'OTA',
            otaId: OTA_ID,
            customerName: CUSTOMER.name,
            customerTaxId: CUSTOMER.taxId,
            currency: 'COP',
            totalAmount: '892500.00',
          },
        ],
      });
    });

    it('HU1: rango de hoy + canal OTA de esta OTA → solo su factura; por documento → las dos', async () => {
      const today = todayInBogota();

      const byChannel = await get('/invoices', {
        channel: 'OTA',
        otaId: OTA_ID,
        issuedFrom: today,
        issuedTo: today,
      });
      const byTaxId = await get('/invoices', { customerTaxId: CUSTOMER.taxId });

      expect(byChannel.body.items.map((item: { stayId: string }) => item.stayId)).toEqual([
        STAYS[0],
      ]);
      // Más reciente primero: la directa se emitió después.
      expect(byTaxId.body.items.map((item: { stayId: string }) => item.stayId)).toEqual([
        STAYS[1],
        STAYS[0],
      ]);
    });

    it('HU1: búsqueda por nombre parcial informa el modo aplicado', async () => {
      const response = await get('/invoices', {
        customerName: 'e2e 008',
        customerMatch: 'PARTIAL',
      });

      expect(response.status).toBe(200);
      expect(response.body.customerMatchMode).toBe('PARTIAL');
      expect(response.body.totalItems).toBe(2);
    });

    it('BR-003: la reserva cancelada antes del check-out no aparece en ningún resultado (T032)', async () => {
      const response = await get('/invoices', { reservationRef: RES_CANCELLED });

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ items: [], totalItems: 0, resultStatus: 'NO_MATCHES' });
      expect(await prisma.settlement.count({ where: { stayId: STAYS[2] } })).toBe(0);
    });

    it('HU2: el detalle coincide exactamente con lo emitido por 006 y con su liquidación (SC-003)', async () => {
      const stored = await prisma.invoice.findUniqueOrThrow({ where: { stayId: STAYS[0] } });
      const settlement = await prisma.settlement.findUniqueOrThrow({ where: { stayId: STAYS[0] } });

      const response = await get(`/invoices/${stored.id}`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        invoiceId: stored.id,
        invoiceNumber: Number(stored.invoiceNumber),
        status: 'ISSUED',
        immutable: true,
        issuedAt: stored.issuedAt.toISOString(),
        settlementId: settlement.id,
        stayId: STAYS[0],
        reservationRef: RES_OTA,
        channel: 'OTA',
        otaId: OTA_ID,
        customer: { name: CUSTOMER.name, taxId: CUSTOMER.taxId },
        currency: 'COP',
        lodgingAmount: '750000.00',
        otaCommissionAmount: '112500.00',
        netIncome: '637500.00',
        vatRateApplied: '19.00',
        vatAmount: '142500.00',
        totalAmount: '892500.00',
      });
      expect(response.body.lodgingAmount).toBe(settlement.lodgingAmount.toFixed(2));
      expect(response.body.otaCommissionAmount).toBe(settlement.otaCommissionAmount.toFixed(2));
    });

    it('HU3: el resumen de hoy agrupa por canal y el total de la OTA es la suma de sus facturas (SC-006)', async () => {
      const today = todayInBogota();

      const response = await get('/invoices/summary', { issuedFrom: today, issuedTo: today });

      expect(response.status).toBe(200);
      expect(response.body.timezone).toBe('America/Bogota');
      expect(response.body.channels[0]).toMatchObject({ channel: 'DIRECT', otaId: null });
      expect(response.body.channels[0].invoiceCount).toBeGreaterThanOrEqual(1);
      expect(
        response.body.channels.find(
          (channel: { otaId: string | null }) => channel.otaId === OTA_ID,
        ),
      ).toEqual({
        channel: 'OTA',
        otaId: OTA_ID,
        invoiceCount: 1,
        totalLodging: '750000.00',
        totalOtaCommission: '112500.00',
        totalVat: '142500.00',
        totalInvoiced: '892500.00',
      });
    });

    it('HU3: en un período sin facturas la OTA aparece en cero', async () => {
      const response = await get('/invoices/summary', {
        issuedFrom: '2000-01-01',
        issuedTo: '2000-01-31',
      });

      expect(
        response.body.channels.find(
          (channel: { otaId: string | null }) => channel.otaId === OTA_ID,
        ),
      ).toMatchObject({ invoiceCount: 0, totalInvoiced: '0.00' });
    });

    it('las tres consultas no cambian ninguna factura ni liquidación (NFR-004)', async () => {
      const snapshot = async () => ({
        invoices: await prisma.invoice.findMany({
          where: { stayId: { in: STAYS } },
          orderBy: { id: 'asc' },
        }),
        settlements: await prisma.settlement.findMany({
          where: { stayId: { in: STAYS } },
          orderBy: { id: 'asc' },
        }),
      });
      const before = await snapshot();
      const today = todayInBogota();

      await get('/invoices', { customerTaxId: CUSTOMER.taxId });
      await get(`/invoices/${before.invoices[0].id}`);
      await get('/invoices/summary', { issuedFrom: today, issuedTo: today });

      expect(await snapshot()).toEqual(before);
    });

    it('una OTA no puede usar Gestionar facturación (FR-010)', async () => {
      const response = await get('/invoices', { reservationRef: RES_OTA }, otaToken);
      expect(response.status).toBe(403);
      expect(response.body.errorCode).toBe('FORBIDDEN');
    });
  },
);
