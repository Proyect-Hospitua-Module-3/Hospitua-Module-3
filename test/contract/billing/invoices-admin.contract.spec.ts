// Feature 008 · Gestionar facturación (T013, T021, T027, T034)
// Contratos GET-invoices.md, GET-invoices-id.md y GET-invoices-summary.md (proveedor 008,
// consumidor el Administrador). AppModule completo con el puerto de lectura en memoria:
// comprueba la forma exacta de cada respuesta, cada error y que no haya escrituras. El
// comportamiento contra PostgreSQL está en test/e2e/billing/gestionar-facturacion.e2e-spec.ts.
process.env.JWT_SECRET = 'secreto-solo-para-pruebas';
process.env.JWT_EXPIRES_IN_SECONDS = '3600';
process.env.MODULE1_BASE_URL = 'http://localhost:3001';
process.env.MODULE1_TIMEOUT_MS = '500';
process.env.MODULE2_BASE_URL = 'http://localhost:3002';
process.env.MODULE2_TIMEOUT_MS = '500';

import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../../src/app.module';
import { INVOICE_QUERY } from '../../../src/domain/ports/out/billing/invoice-query.port';
import { PrismaService } from '../../../src/infrastructure/adapters/out/persistence/prisma.service';
import {
  directInvoice,
  InMemoryInvoiceQuery,
  otaInvoice,
} from '../../support/billing/in-memory-invoice-query';

const DECIMAL_2 = /^\d+\.\d{2}$/;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UNKNOWN_ID = '7d1c2f0e-4b8a-4c51-9a3e-2f6b1d9c8e99';

// Contratos, «Respuesta exitosa»: estos campos y ningún otro.
const SEARCH_FIELDS = [
  'asOf',
  'customerMatchMode',
  'items',
  'page',
  'pageSize',
  'resultStatus',
  'totalItems',
  'totalPages',
];
const SEARCH_ITEM_FIELDS = [
  'channel',
  'currency',
  'customerName',
  'customerTaxId',
  'invoiceId',
  'invoiceNumber',
  'issuedAt',
  'otaId',
  'reservationRef',
  'stayId',
  'totalAmount',
];
const DETAIL_FIELDS = [
  'channel',
  'currency',
  'customer',
  'immutable',
  'invoiceId',
  'invoiceNumber',
  'issuedAt',
  'lodgingAmount',
  'netIncome',
  'otaCommissionAmount',
  'otaId',
  'reservationRef',
  'settlementId',
  'status',
  'stayId',
  'totalAmount',
  'vatAmount',
  'vatRateApplied',
];
const CHANNEL_FIELDS = [
  'channel',
  'invoiceCount',
  'otaId',
  'totalInvoiced',
  'totalLodging',
  'totalOtaCommission',
  'totalVat',
];
// Datos migratorios y del huésped que nunca salen (FR-009, NFR-003).
const FORBIDDEN_FIELDS = [
  'nationality',
  'documentType',
  'documentNumber',
  'visaType',
  'guestName',
  'birthDate',
  'sourceEventId',
  'billingCustomer',
];

describe('Contrato /invoices (008 → Administrador)', () => {
  let app: INestApplication;
  let invoices: InMemoryInvoiceQuery;
  let adminToken: string;
  let otaToken: string;

  beforeEach(async () => {
    invoices = new InMemoryInvoiceQuery();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue({})
      .overrideProvider(INVOICE_QUERY)
      .useValue(invoices)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();

    const jwt = app.get(JwtService);
    adminToken = jwt.sign({ sub: 'f2d3b4a5-6c7d-4e8f-9012-3456789abcde', role: 'Administrador' });
    otaToken = jwt.sign({
      sub: '0b8a4c1e-2d3f-4a5b-8c6d-7e8f9a0b1c2d',
      role: 'OTA',
      otaId: 'booking',
    });
  });

  afterEach(async () => {
    await app?.close();
  });

  const get = (
    path: string,
    query: Record<string, string> = {},
    token: string | null = adminToken,
  ) => {
    const call = request(app.getHttpServer()).get(path).query(query);
    return token ? call.set('Authorization', `Bearer ${token}`) : call;
  };

  function expectApiError(
    response: request.Response,
    status: number,
    errorCode: string,
    path: string,
  ): void {
    expect(response.status).toBe(status);
    expect(response.body).toEqual({
      errorCode,
      message: expect.any(String),
      timestamp: expect.stringMatching(ISO_INSTANT),
      path: expect.stringContaining(path),
    });
    expect(response.body.message.length).toBeGreaterThan(0);
  }

  function expectNoForbiddenFields(body: unknown): void {
    const text = JSON.stringify(body);
    for (const field of FORBIDDEN_FIELDS) expect(text).not.toContain(`"${field}"`);
  }

  describe('GET /invoices — buscar (HU1)', () => {
    it('200 con el ejemplo del contrato: campos exactos, decimales como texto y asOf', async () => {
      const invoice = otaInvoice({ invoiceNumber: 1042 });
      invoices.invoices.push(invoice);

      const response = await get('/invoices', {
        channel: 'OTA',
        otaId: 'booking',
        issuedFrom: '2026-12-01',
        issuedTo: '2026-12-31',
        page: '1',
        pageSize: '20',
      });

      expect(response.status).toBe(200);
      expect(Object.keys(response.body).sort()).toEqual(SEARCH_FIELDS);
      expect(response.body).toEqual({
        items: [
          {
            invoiceId: invoice.invoiceId,
            invoiceNumber: 1042,
            issuedAt: '2026-12-23T16:05:12.000Z',
            stayId: invoice.stayId,
            reservationRef: 'RES-000123',
            channel: 'OTA',
            otaId: 'booking',
            customerName: 'Comercializadora Andina S.A.S.',
            customerTaxId: '900123456-7',
            currency: 'COP',
            totalAmount: '892500.00',
          },
        ],
        page: 1,
        pageSize: 20,
        totalItems: 1,
        totalPages: 1,
        asOf: '2026-12-31T23:20:00.000Z',
        resultStatus: 'MATCHES',
        customerMatchMode: null,
      });
      expect(Object.keys(response.body.items[0]).sort()).toEqual(SEARCH_ITEM_FIELDS);
      expect(typeof response.body.items[0].invoiceNumber).toBe('number');
      expect(response.body.items[0].totalAmount).toMatch(DECIMAL_2);
      expectNoForbiddenFields(response.body);
    });

    it('200 sin coincidencias: NO_MATCHES, lista vacía y modo de coincidencia (FR-008)', async () => {
      invoices.invoices.push(otaInvoice());

      const response = await get('/invoices', { customerName: 'Nadie', customerMatch: 'PARTIAL' });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        items: [],
        page: 1,
        pageSize: 20,
        totalItems: 0,
        totalPages: 0,
        asOf: expect.stringMatching(ISO_INSTANT),
        resultStatus: 'NO_MATCHES',
        customerMatchMode: 'PARTIAL',
      });
    });

    it('el asOf devuelto se puede reenviar tal cual para la página siguiente', async () => {
      for (let n = 1; n <= 3; n++) {
        invoices.invoices.push(
          otaInvoice({ invoiceNumber: n, issuedAt: new Date(Date.UTC(2026, 11, n)) }),
        );
      }

      const first = await get('/invoices', { channel: 'OTA', pageSize: '2' });
      const second = await get('/invoices', {
        channel: 'OTA',
        pageSize: '2',
        page: '2',
        asOf: first.body.asOf,
      });

      expect(first.body.items.map((item: { invoiceNumber: number }) => item.invoiceNumber)).toEqual(
        [3, 2],
      );
      expect(second.status).toBe(200);
      expect(second.body.asOf).toBe(first.body.asOf);
      expect(
        second.body.items.map((item: { invoiceNumber: number }) => item.invoiceNumber),
      ).toEqual([1]);
    });

    it('400 MISSING_SEARCH_CRITERIA sin criterios, sin consultar la base de datos', async () => {
      const response = await get('/invoices', { page: '1', pageSize: '20' });

      expectApiError(response, 400, 'MISSING_SEARCH_CRITERIA', '/invoices');
      expect(response.body.message).toBe(
        'Debe indicar al menos un criterio de búsqueda: estancia, reserva, cliente, canal o rango de fechas de emisión.',
      );
      expect(invoices.calls).toBe(0);
    });

    it('400 INVALID_DATE_RANGE con rango invertido o con una sola fecha', async () => {
      expectApiError(
        await get('/invoices', { issuedFrom: '2026-12-31', issuedTo: '2026-12-01' }),
        400,
        'INVALID_DATE_RANGE',
        '/invoices',
      );
      expectApiError(
        await get('/invoices', { issuedFrom: '2026-12-01' }),
        400,
        'INVALID_DATE_RANGE',
        '/invoices',
      );
      expect(invoices.calls).toBe(0);
    });

    it.each([
      ['stayId no UUID', { stayId: 'estancia-1' }],
      ['fecha mal escrita', { issuedFrom: '2026-12-1', issuedTo: '2026-12-31' }],
      ['pageSize fuera de 1–100', { channel: 'OTA', pageSize: '101' }],
      ['asOf futuro', { channel: 'OTA', asOf: '2099-01-01T00:00:00.000Z' }],
      ['otaId sin channel=OTA', { otaId: 'booking', reservationRef: 'RES-000123' }],
      ['PARTIAL con menos de 3 caracteres', { customerName: 'An', customerMatch: 'PARTIAL' }],
    ])('400 INVALID_QUERY_PARAMS: %s', async (_case, query) => {
      expectApiError(await get('/invoices', query), 400, 'INVALID_QUERY_PARAMS', '/invoices');
    });

    it('400 INVALID_QUERY_PARAMS con un parámetro repetido', async () => {
      const response = await request(app.getHttpServer())
        .get('/invoices?reservationRef=RES-1&reservationRef=RES-2')
        .set('Authorization', `Bearer ${adminToken}`);
      expectApiError(response, 400, 'INVALID_QUERY_PARAMS', '/invoices');
    });
  });

  describe('GET /invoices/{invoiceId} — detalle (HU2)', () => {
    it('200 con el ejemplo del contrato: lista blanca de campos, ISSUED e inmutable', async () => {
      const invoice = otaInvoice({ invoiceNumber: 1042 });
      invoices.invoices.push(invoice);

      const response = await get(`/invoices/${invoice.invoiceId}`);

      expect(response.status).toBe(200);
      expect(Object.keys(response.body).sort()).toEqual(DETAIL_FIELDS);
      expect(response.body).toEqual({
        invoiceId: invoice.invoiceId,
        invoiceNumber: 1042,
        status: 'ISSUED',
        immutable: true,
        issuedAt: '2026-12-23T16:05:12.000Z',
        settlementId: invoice.settlementId,
        stayId: invoice.stayId,
        reservationRef: 'RES-000123',
        channel: 'OTA',
        otaId: 'booking',
        customer: { name: 'Comercializadora Andina S.A.S.', taxId: '900123456-7' },
        currency: 'COP',
        lodgingAmount: '750000.00',
        otaCommissionAmount: '112500.00',
        netIncome: '637500.00',
        vatRateApplied: '19.00',
        vatAmount: '142500.00',
        totalAmount: '892500.00',
      });
      expect(Object.keys(response.body.customer).sort()).toEqual(['name', 'taxId']);
      expect(response.body.settlementId).toMatch(UUID);
      expectNoForbiddenFields(response.body);
    });

    it('canal directo: otaId null y comisión "0.00"', async () => {
      const invoice = directInvoice();
      invoices.invoices.push(invoice);

      const response = await get(`/invoices/${invoice.invoiceId}`);

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        channel: 'DIRECT',
        otaId: null,
        otaCommissionAmount: '0.00',
      });
    });

    it('404 INVOICE_NOT_FOUND con un id que no existe', async () => {
      const response = await get(`/invoices/${UNKNOWN_ID}`);

      expectApiError(response, 404, 'INVOICE_NOT_FOUND', `/invoices/${UNKNOWN_ID}`);
      expect(response.body.message).toBe(
        `No existe una factura con el identificador ${UNKNOWN_ID}.`,
      );
    });

    it('400 INVALID_QUERY_PARAMS con un id que no es UUID', async () => {
      expectApiError(await get('/invoices/1042'), 400, 'INVALID_QUERY_PARAMS', '/invoices/1042');
      expect(invoices.calls).toBe(0);
    });
  });

  describe('GET /invoices/summary — resumen por canal (HU3)', () => {
    it('200 con timezone, currency y un grupo por canal; DIRECT siempre presente', async () => {
      invoices.invoices.push(
        otaInvoice({ issuedAt: new Date('2026-12-08T15:00:00.000Z') }),
        otaInvoice({ otaId: 'airbnb', issuedAt: new Date('2026-10-08T15:00:00.000Z') }),
      );

      const response = await get('/invoices/summary', {
        issuedFrom: '2026-12-01',
        issuedTo: '2026-12-31',
      });

      expect(response.status).toBe(200);
      expect(Object.keys(response.body).sort()).toEqual([
        'channels',
        'currency',
        'range',
        'timezone',
      ]);
      expect(response.body).toEqual({
        range: { issuedFrom: '2026-12-01', issuedTo: '2026-12-31' },
        timezone: 'America/Bogota',
        currency: 'COP',
        channels: [
          {
            channel: 'DIRECT',
            otaId: null,
            invoiceCount: 0,
            totalLodging: '0.00',
            totalOtaCommission: '0.00',
            totalVat: '0.00',
            totalInvoiced: '0.00',
          },
          {
            channel: 'OTA',
            otaId: 'airbnb',
            invoiceCount: 0,
            totalLodging: '0.00',
            totalOtaCommission: '0.00',
            totalVat: '0.00',
            totalInvoiced: '0.00',
          },
          {
            channel: 'OTA',
            otaId: 'booking',
            invoiceCount: 1,
            totalLodging: '750000.00',
            totalOtaCommission: '112500.00',
            totalVat: '142500.00',
            totalInvoiced: '892500.00',
          },
        ],
      });
      for (const channel of response.body.channels) {
        expect(Object.keys(channel).sort()).toEqual(CHANNEL_FIELDS);
      }
    });

    it('400 INVALID_DATE_RANGE si falta una fecha o el rango está invertido', async () => {
      expectApiError(
        await get('/invoices/summary'),
        400,
        'INVALID_DATE_RANGE',
        '/invoices/summary',
      );
      expectApiError(
        await get('/invoices/summary', { issuedFrom: '2026-12-01' }),
        400,
        'INVALID_DATE_RANGE',
        '/invoices/summary',
      );
      expectApiError(
        await get('/invoices/summary', { issuedFrom: '2026-12-31', issuedTo: '2026-12-01' }),
        400,
        'INVALID_DATE_RANGE',
        '/invoices/summary',
      );
      expect(invoices.calls).toBe(0);
    });

    it('400 INVALID_QUERY_PARAMS si una fecha no es YYYY-MM-DD', async () => {
      expectApiError(
        await get('/invoices/summary', { issuedFrom: '01/12/2026', issuedTo: '2026-12-31' }),
        400,
        'INVALID_QUERY_PARAMS',
        '/invoices/summary',
      );
    });
  });

  describe('Acceso: solo el Administrador (FR-010, SC-005)', () => {
    const paths = [
      '/invoices?channel=OTA',
      `/invoices/${UNKNOWN_ID}`,
      '/invoices/summary?issuedFrom=2026-12-01&issuedTo=2026-12-31',
    ];

    it.each(paths)('401 UNAUTHENTICATED sin token: %s', async (path) => {
      const response = await request(app.getHttpServer()).get(path);
      expectApiError(response, 401, 'UNAUTHENTICATED', path.split('?')[0]);
      expect(invoices.calls).toBe(0);
    });

    it.each(paths)('401 UNAUTHENTICATED con token inválido: %s', async (path) => {
      const response = await request(app.getHttpServer())
        .get(path)
        .set('Authorization', 'Bearer no-es-un-jwt');
      expectApiError(response, 401, 'UNAUTHENTICATED', path.split('?')[0]);
    });

    it.each(paths)('403 FORBIDDEN con token de OTA: %s', async (path) => {
      const response = await request(app.getHttpServer())
        .get(path)
        .set('Authorization', `Bearer ${otaToken}`);
      expectApiError(response, 403, 'FORBIDDEN', path.split('?')[0]);
      expect(invoices.calls).toBe(0);
    });

    it('la autorización va antes de la validación: OTA sin criterios → 403, no 400', async () => {
      expectApiError(await get('/invoices', {}, otaToken), 403, 'FORBIDDEN', '/invoices');
    });
  });

  describe('Solo lectura: no hay POST, PUT, PATCH ni DELETE sobre /invoices (FR-006)', () => {
    const invoiceId = '7d1c2f0e-4b8a-4c51-9a3e-2f6b1d9c8e01';
    it.each([
      ['post', '/invoices'],
      ['put', `/invoices/${invoiceId}`],
      ['patch', `/invoices/${invoiceId}`],
      ['delete', `/invoices/${invoiceId}`],
      ['post', `/invoices/${invoiceId}`],
    ] as const)('%s %s → 404 NOT_FOUND y nada cambia', async (method, path) => {
      const response = await request(app.getHttpServer())
        [method](path)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ totalAmount: '0.00' });

      expect(response.status).toBe(404);
      expect(response.body.errorCode).toBe('NOT_FOUND');
      expect(invoices.calls).toBe(0);
    });
  });
});
