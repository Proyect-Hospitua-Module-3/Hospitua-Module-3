// Feature 002 · Consultar liquidación
// T007 y T013: contrato GET-settlements.md (proveedor 002, consumidores la OTA y Módulo 1).
// Comprueba la forma exacta de la respuesta de la OTA (colección), la de Módulo 1 (objeto
// individual, FINAL o INFORMATIVE) y cada error del contrato. El comportamiento de punta a
// punta está en test/e2e/settlement/settlements.e2e-spec.ts.
process.env.JWT_SECRET = 'secreto-solo-para-pruebas';
process.env.JWT_EXPIRES_IN_SECONDS = '3600';
process.env.MODULE1_BASE_URL = 'http://localhost:3001';
process.env.MODULE1_TIMEOUT_MS = '500';
process.env.MODULE2_BASE_URL = 'http://localhost:3002';
process.env.MODULE2_TIMEOUT_MS = '500';

import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import Decimal from 'decimal.js';
import request from 'supertest';
import { AppModule } from '../../../src/app.module';
import { InvalidCommissionError } from '../../../src/domain/errors/settlement/invalid-commission.error';
import { MissingCommissionError } from '../../../src/domain/errors/settlement/missing-commission.error';
import { Module2UnavailableError } from '../../../src/domain/errors/settlement/module2-unavailable.error';
import { ReservationNotFoundError } from '../../../src/domain/errors/settlement/reservation-not-found.error';
import { LODGING_QUOTE_QUERY } from '../../../src/domain/ports/out/pricing/lodging-quote-query.port';
import { RESERVATION_CLIENT } from '../../../src/domain/ports/out/settlement/reservation.client.port';
import { SETTLEMENT_INVOICE_QUERY } from '../../../src/domain/ports/out/settlement/settlement-invoice-query.port';
import { SETTLEMENT_QUERY } from '../../../src/domain/ports/out/settlement/settlement-query.port';
import { SETTLEMENT_REPOSITORY } from '../../../src/domain/ports/out/settlement/settlement.repository.port';
import { PrismaService } from '../../../src/infrastructure/adapters/out/persistence/prisma.service';
import {
  directReservation,
  FakeReservationClient,
  InMemoryLodgingQuotes,
  InMemorySettlementRepository,
  otaReservation,
  QUOTE_A,
  QUOTE_B,
  RESERVATION_REF,
  ROOM_A,
  ROOM_B,
  storedQuote,
} from '../../support/settlement/fake-settlement-ports';
import {
  directFinalSettlement,
  finalSettlement,
  InMemorySettlementInvoices,
  InMemorySettlementQuery,
  OTA_ID,
} from '../../support/settlement/fake-settlement-query-ports';

const DECIMAL_2 = /^-?\d+\.\d{2}$/;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Contrato, «Objeto de liquidación»: estos campos y ningún otro.
const SETTLEMENT_FIELDS = [
  'breakdown',
  'categoryRoom',
  'channel',
  'currency',
  'generatedAt',
  'invoice',
  'otaId',
  'reservationRef',
  'roomId',
  'settlementType',
];
const BREAKDOWN_FIELDS = [
  'baseLodgingAmount',
  'dynamicAdjustmentAmount',
  'lodgingAmount',
  'netIncome',
  'otaCommissionAmount',
  'otaCommissionPercentage',
];
const INVOICE_FIELDS = [
  'invoiceId',
  'invoiceNumber',
  'issuedAt',
  'status',
  'totalAmount',
  'vatAmount',
  'vatRateApplied',
];
// Datos que la respuesta nunca expone (FR-007, NFR-004).
const FORBIDDEN_FIELDS = [
  'billingCustomer',
  'customerName',
  'customerTaxId',
  'stayId',
  'quoteId',
  'checkInDate',
  'checkOutDate',
  'otaConfirmationCode',
  'sourceEventId',
  'settlementId',
];

// ROOM_B: 2 noches, 500.000 de tarifa base y 600.000 de hospedaje.
function roomBQuote() {
  return storedQuote(
    QUOTE_B,
    ROOM_B,
    [
      ['2026-12-20', '250000.00', '300000.00'],
      ['2026-12-21', '250000.00', '300000.00'],
    ],
    '600000.00',
  );
}

describe('Contrato GET /api/settlements (002 → OTA y Módulo 1)', () => {
  let app: INestApplication;
  let settlements: InMemorySettlementQuery;
  let invoices: InMemorySettlementInvoices;
  // Módulo 1: la Final por habitación (007), la reserva (Módulo 2) y las cotizaciones (005).
  let finals: InMemorySettlementRepository;
  let reservations: FakeReservationClient;
  let quotes: InMemoryLodgingQuotes;
  let otaToken: string;
  let otaWithoutIdToken: string;
  let adminToken: string;

  beforeEach(async () => {
    settlements = new InMemorySettlementQuery();
    invoices = new InMemorySettlementInvoices();
    finals = new InMemorySettlementRepository();
    reservations = new FakeReservationClient(otaReservation());
    // La reserva por defecto solo trae QUOTE_A: la de ROOM_B aparece solo si la reserva
    // la incluye en sus quoteIds.
    quotes = new InMemoryLodgingQuotes([storedQuote(QUOTE_A, ROOM_A), roomBQuote()]);

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue({})
      .overrideProvider(SETTLEMENT_QUERY)
      .useValue(settlements)
      .overrideProvider(SETTLEMENT_INVOICE_QUERY)
      .useValue(invoices)
      .overrideProvider(SETTLEMENT_REPOSITORY)
      .useValue(finals)
      .overrideProvider(RESERVATION_CLIENT)
      .useValue(reservations)
      .overrideProvider(LODGING_QUOTE_QUERY)
      .useValue(quotes)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();

    const jwt = app.get(JwtService);
    otaToken = jwt.sign({
      sub: '0b8a4c1e-2d3f-4a5b-8c6d-7e8f9a0b1c2d',
      role: 'OTA',
      otaId: OTA_ID,
    });
    otaWithoutIdToken = jwt.sign({ sub: '0b8a4c1e-2d3f-4a5b-8c6d-7e8f9a0b1c2d', role: 'OTA' });
    adminToken = jwt.sign({ sub: 'f2d3b4a5-6c7d-4e8f-9012-3456789abcde', role: 'Administrador' });
  });

  afterEach(async () => {
    await app?.close();
  });

  const get = (query: Record<string, string>, token?: string) => {
    const call = request(app.getHttpServer()).get('/api/settlements').query(query);
    return token ? call.set('Authorization', `Bearer ${token}`) : call;
  };

  function expectApiError(response: request.Response, status: number, errorCode: string): void {
    expect(response.status).toBe(status);
    expect(response.body).toEqual({
      errorCode,
      message: expect.any(String),
      timestamp: expect.stringMatching(ISO_INSTANT),
      path: expect.stringContaining('/api/settlements'),
    });
    expect(response.body.message.length).toBeGreaterThan(0);
    // Ningún error lleva información financiera (FR-013, SC-010).
    // (el timestamp sí tiene "ss.mmm", por eso solo se mira el mensaje).
    expect(response.body.message).not.toMatch(/\d+\.\d{2}/);
  }

  describe('200 OTA: colección de liquidaciones Final (contrato, «Respuesta de OTA»)', () => {
    it('devuelve exactamente { reservationRef, settlements } con el ejemplo del contrato', async () => {
      const settlement = finalSettlement({ roomId: ROOM_A });
      settlements.settlements.push(settlement);
      invoices.emit(settlement, { invoiceNumber: 1042 });

      const response = await get({ reservationRef: RESERVATION_REF }, otaToken);

      expect(response.status).toBe(200);
      expect(Object.keys(response.body).sort()).toEqual(['reservationRef', 'settlements']);
      expect(response.body).toEqual({
        reservationRef: RESERVATION_REF,
        settlements: [
          {
            settlementType: 'FINAL',
            reservationRef: RESERVATION_REF,
            roomId: ROOM_A,
            categoryRoom: 'DOBLE',
            channel: 'OTA',
            otaId: OTA_ID,
            currency: 'COP',
            breakdown: {
              baseLodgingAmount: '700000.00',
              dynamicAdjustmentAmount: '50000.00',
              lodgingAmount: '750000.00',
              otaCommissionPercentage: '15.00',
              otaCommissionAmount: '112500.00',
              netIncome: '637500.00',
            },
            invoice: {
              invoiceId: expect.stringMatching(UUID),
              invoiceNumber: 1042,
              issuedAt: '2026-12-23T16:05:12.000Z',
              vatRateApplied: '19.00',
              vatAmount: '142500.00',
              totalAmount: '892500.00',
              status: 'ISSUED',
            },
            generatedAt: '2026-12-23T16:04:58.000Z',
          },
        ],
      });
    });

    it('cada objeto tiene solo los campos del contrato, con los tipos del contrato', async () => {
      const withInvoice = finalSettlement({ roomId: ROOM_A });
      settlements.settlements.push(withInvoice, finalSettlement({ roomId: ROOM_B }));
      invoices.emit(withInvoice);

      const response = await get({ reservationRef: RESERVATION_REF }, otaToken);

      expect(response.status).toBe(200);
      expect(response.body.settlements).toHaveLength(2);
      for (const item of response.body.settlements) {
        expect(Object.keys(item).sort()).toEqual(SETTLEMENT_FIELDS);
        expect(Object.keys(item.breakdown).sort()).toEqual(BREAKDOWN_FIELDS);
        expect(item.settlementType).toBe('FINAL');
        expect(item.currency).toBe('COP');
        expect(item.generatedAt).toMatch(ISO_INSTANT);
        for (const field of BREAKDOWN_FIELDS) {
          if (field !== 'otaCommissionPercentage') expect(item.breakdown[field]).toMatch(DECIMAL_2);
        }
        expect(item.breakdown.otaCommissionPercentage).toMatch(DECIMAL_2);
      }
      const [first, second] = response.body.settlements;
      expect(Object.keys(first.invoice).sort()).toEqual(INVOICE_FIELDS);
      expect(typeof first.invoice.invoiceNumber).toBe('number');
      expect(first.invoice.issuedAt).toMatch(ISO_INSTANT);
      expect(second.invoice).toBeNull();
    });

    it('siempre se cumple lodgingAmount = baseLodgingAmount + dynamicAdjustmentAmount, también con ajuste negativo (T007)', async () => {
      settlements.settlements.push(
        finalSettlement({ roomId: ROOM_A }),
        finalSettlement({
          roomId: ROOM_B,
          lodgingAmount: '540000.00',
          baseLodgingAmount: '600000.00',
          dynamicAdjustmentAmount: '-60000.00',
          otaCommissionAmount: '81000.00',
          netIncome: '459000.00',
        }),
      );

      const response = await get({ reservationRef: RESERVATION_REF }, otaToken);

      expect(response.body.settlements).toHaveLength(2);
      for (const { breakdown } of response.body.settlements) {
        expect(
          new Decimal(breakdown.baseLodgingAmount)
            .plus(breakdown.dynamicAdjustmentAmount)
            .equals(breakdown.lodgingAmount),
        ).toBe(true);
      }
      expect(response.body.settlements[1].breakdown.dynamicAdjustmentAmount).toBe('-60000.00');
    });

    it('no incluye datos migratorios, datos personales del huésped ni billingCustomer (FR-007, NFR-004)', async () => {
      const settlement = finalSettlement();
      settlements.settlements.push(settlement);
      invoices.emit(settlement);

      const response = await get({ reservationRef: RESERVATION_REF }, otaToken);
      const text = JSON.stringify(response.body);

      for (const field of FORBIDDEN_FIELDS) {
        expect(text).not.toContain(`"${field}"`);
      }
      expect(text).not.toContain('BKG-88421');
    });

    it('lleva Cache-Control: no-store y devuelve el X-Correlation-Id recibido', async () => {
      settlements.settlements.push(finalSettlement());

      const response = await get({ reservationRef: RESERVATION_REF }, otaToken).set(
        'X-Correlation-Id',
        'corr-002-contrato',
      );

      expect(response.status).toBe(200);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.headers['x-correlation-id']).toBe('corr-002-contrato');
    });

    it('ignora roomId, categoryRoom, las fechas, source y los parámetros no listados (contrato, «Parámetros»)', async () => {
      settlements.settlements.push(
        finalSettlement({ roomId: ROOM_A }),
        finalSettlement({ roomId: ROOM_B }),
      );

      const response = await get(
        {
          reservationRef: RESERVATION_REF,
          roomId: 'no-es-uuid',
          categoryRoom: 'SUITE',
          checkInDate: 'ayer',
          checkOutDate: '2026-13-45',
          source: 'DIRECT',
          otro: 'x',
        },
        otaToken,
      );

      expect(response.status).toBe(200);
      expect(response.body.settlements.map((item: { roomId: string }) => item.roomId)).toEqual([
        ROOM_A,
        ROOM_B,
      ]);
      expect(response.body.settlements[0].categoryRoom).toBe('DOBLE');
    });
  });

  describe('Errores (contrato, sección 5)', () => {
    it('404 SETTLEMENT_NOT_FOUND: la reserva no tiene liquidaciones Final', async () => {
      const response = await get({ reservationRef: 'RES-SIN-CHECKOUT' }, otaToken);

      expectApiError(response, 404, 'SETTLEMENT_NOT_FOUND');
      expect(response.headers['cache-control']).toBe('no-store');
    });

    it('404 SETTLEMENT_NOT_FOUND: la reserva es del canal directo o de otra OTA', async () => {
      settlements.settlements.push(
        directFinalSettlement({ reservationRef: 'RES-DIRECTA' }),
        finalSettlement({ reservationRef: 'RES-EXPEDIA', otaId: 'expedia' }),
      );

      expectApiError(
        await get({ reservationRef: 'RES-DIRECTA' }, otaToken),
        404,
        'SETTLEMENT_NOT_FOUND',
      );
      expectApiError(
        await get({ reservationRef: 'RES-EXPEDIA' }, otaToken),
        404,
        'SETTLEMENT_NOT_FOUND',
      );
    });

    it('400 INVALID_QUERY_PARAMS: la OTA no envía reservationRef', async () => {
      const response = await get({}, otaToken);

      expectApiError(response, 400, 'INVALID_QUERY_PARAMS');
      expect(settlements.calls).toEqual([]);
    });

    it('401 UNAUTHENTICATED: token inválido', async () => {
      const response = await get({ reservationRef: RESERVATION_REF }, 'no-es-un-jwt');

      expectApiError(response, 401, 'UNAUTHENTICATED');
      expect(response.headers['cache-control']).toBe('no-store');
    });

    it('401 UNAUTHENTICATED: token OTA sin claim otaId', async () => {
      settlements.settlements.push(finalSettlement());

      const response = await get({ reservationRef: RESERVATION_REF }, otaWithoutIdToken);

      expectApiError(response, 401, 'UNAUTHENTICATED');
      expect(settlements.calls).toEqual([]);
    });

    it('403 FORBIDDEN: token válido con un rol distinto de OTA', async () => {
      settlements.settlements.push(finalSettlement());

      const response = await get({ reservationRef: RESERVATION_REF }, adminToken);

      expectApiError(response, 403, 'FORBIDDEN');
      expect(response.headers['cache-control']).toBe('no-store');
      expect(settlements.calls).toEqual([]);
    });
  });

  describe('200 Módulo 1: objeto individual (contrato, «Respuesta de Módulo 1»)', () => {
    it('INFORMATIVE: devuelve exactamente el objeto del contrato, con categoryRoom null aunque se envíe', async () => {
      reservations.respondWith(otaReservation({ quoteIds: [QUOTE_A, QUOTE_B] }));

      const response = await get({
        reservationRef: RESERVATION_REF,
        roomId: ROOM_B,
        categoryRoom: 'SUITE',
      });

      expect(response.status).toBe(200);
      expect(Object.keys(response.body).sort()).toEqual(SETTLEMENT_FIELDS);
      expect(response.body).toEqual({
        settlementType: 'INFORMATIVE',
        reservationRef: RESERVATION_REF,
        roomId: ROOM_B,
        categoryRoom: null,
        channel: 'OTA',
        otaId: OTA_ID,
        currency: 'COP',
        breakdown: {
          baseLodgingAmount: '500000.00',
          dynamicAdjustmentAmount: '100000.00',
          lodgingAmount: '600000.00',
          otaCommissionPercentage: '15.00',
          otaCommissionAmount: '90000.00',
          netIncome: '510000.00',
        },
        invoice: null,
        generatedAt: expect.stringMatching(ISO_INSTANT),
      });
      // La reserva sale de ReservationClientPort y la cotización de findByIds con sus
      // quoteIds, elegida por roomId (contrato, «Respuesta de Módulo 1»).
      expect(reservations.calls).toEqual([
        { reservationRef: RESERVATION_REF, correlationId: expect.any(String) },
      ]);
      expect(quotes.requests).toEqual([[QUOTE_A, QUOTE_B]]);
    });

    it('INFORMATIVE de canal directo: sin comisión, otaId null y la igualdad del desglose', async () => {
      reservations.respondWith(directReservation());

      const response = await get({ reservationRef: RESERVATION_REF, roomId: ROOM_A });

      expect(response.status).toBe(200);
      const { breakdown } = response.body;
      expect(response.body).toMatchObject({
        settlementType: 'INFORMATIVE',
        channel: 'DIRECT',
        otaId: null,
        categoryRoom: null,
        invoice: null,
      });
      expect(Object.keys(breakdown).sort()).toEqual(BREAKDOWN_FIELDS);
      expect(breakdown.otaCommissionPercentage).toBeNull();
      expect(breakdown.otaCommissionAmount).toBe('0.00');
      expect(breakdown.netIncome).toBe(breakdown.lodgingAmount);
      for (const field of BREAKDOWN_FIELDS) {
        if (field !== 'otaCommissionPercentage') expect(breakdown[field]).toMatch(DECIMAL_2);
      }
      expect(
        new Decimal(breakdown.baseLodgingAmount)
          .plus(breakdown.dynamicAdjustmentAmount)
          .equals(breakdown.lodgingAmount),
      ).toBe(true);
    });

    it('FINAL existente consultada sin categoryRoom: 200 con categoryRoom de la liquidación y su factura', async () => {
      const stored = finals.seed(finalSettlement({ roomId: ROOM_A }));
      invoices.emit(stored, { invoiceNumber: 1042 });

      const response = await get({ reservationRef: RESERVATION_REF, roomId: ROOM_A });

      expect(response.status).toBe(200);
      expect(Object.keys(response.body).sort()).toEqual(SETTLEMENT_FIELDS);
      expect(response.body).toMatchObject({
        settlementType: 'FINAL',
        roomId: ROOM_A,
        categoryRoom: 'DOBLE',
        breakdown: { lodgingAmount: '750000.00', netIncome: '637500.00' },
        invoice: { invoiceNumber: 1042, status: 'ISSUED' },
        generatedAt: '2026-12-23T16:04:58.000Z',
      });
      expect(Object.keys(response.body.invoice).sort()).toEqual(INVOICE_FIELDS);
      expect(reservations.calls).toEqual([]);
    });

    it('el parámetro categoryRoom nunca se refleja en la respuesta, ni en la FINAL ni en la INFORMATIVE', async () => {
      finals.seed(finalSettlement({ roomId: ROOM_B }));

      const informative = await get({
        reservationRef: RESERVATION_REF,
        roomId: ROOM_A,
        categoryRoom: 'PENTHOUSE-X',
      });
      const final = await get({
        reservationRef: RESERVATION_REF,
        roomId: ROOM_B,
        categoryRoom: 'PENTHOUSE-X',
      });

      expect(informative.status).toBe(200);
      expect(final.status).toBe(200);
      expect(JSON.stringify(informative.body)).not.toContain('PENTHOUSE-X');
      expect(JSON.stringify(final.body)).not.toContain('PENTHOUSE-X');
      expect(final.body.categoryRoom).toBe('DOBLE');
    });

    it('no incluye datos migratorios, datos personales del huésped ni billingCustomer (FR-007, NFR-004)', async () => {
      const response = await get({ reservationRef: RESERVATION_REF, roomId: ROOM_A });
      const text = JSON.stringify(response.body);

      expect(response.status).toBe(200);
      for (const field of FORBIDDEN_FIELDS) {
        expect(text).not.toContain(`"${field}"`);
      }
      expect(text).not.toContain('BKG-88421');
    });

    it('lleva Cache-Control: no-store y devuelve el X-Correlation-Id recibido, que también llega a Módulo 2', async () => {
      const response = await get({ reservationRef: RESERVATION_REF, roomId: ROOM_A }).set(
        'X-Correlation-Id',
        'corr-002-modulo1',
      );

      expect(response.status).toBe(200);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.headers['x-correlation-id']).toBe('corr-002-modulo1');
      expect(reservations.calls).toEqual([
        { reservationRef: RESERVATION_REF, correlationId: 'corr-002-modulo1' },
      ]);
    });
  });

  describe('Errores de Módulo 1 (contrato, sección 5)', () => {
    it('400 INVALID_QUERY_PARAMS: falta reservationRef o roomId, o roomId no es UUID, sin consultar nada', async () => {
      const queries: Array<Record<string, string>> = [
        { roomId: ROOM_A },
        { reservationRef: RESERVATION_REF },
        { reservationRef: RESERVATION_REF, roomId: 'habitacion-1' },
        { reservationRef: RESERVATION_REF, categoryRoom: 'DOBLE' },
      ];
      for (const query of queries) {
        const response = await get(query);
        expectApiError(response, 400, 'INVALID_QUERY_PARAMS');
        expect(response.headers['cache-control']).toBe('no-store');
      }
      expect(reservations.calls).toEqual([]);
      expect(settlements.calls).toEqual([]);
    });

    it('404 RESERVATION_NOT_FOUND: Módulo 2 no tiene la reserva', async () => {
      reservations.respondWith(new ReservationNotFoundError(RESERVATION_REF));

      expectApiError(
        await get({ reservationRef: RESERVATION_REF, roomId: ROOM_A }),
        404,
        'RESERVATION_NOT_FOUND',
      );
    });

    it('404 QUOTE_NOT_FOUND: ninguna cotización de la reserva es de la habitación', async () => {
      expectApiError(
        await get({ reservationRef: RESERVATION_REF, roomId: ROOM_B }),
        404,
        'QUOTE_NOT_FOUND',
      );
    });

    it('409 MISSING_COMMISSION e INVALID_COMMISSION: reserva OTA sin comisión o con comisión inválida', async () => {
      reservations.respondWith(otaReservation({ otaCommissionPercentage: null }));
      expectApiError(
        await get({ reservationRef: RESERVATION_REF, roomId: ROOM_A }),
        409,
        new MissingCommissionError(RESERVATION_REF, OTA_ID).errorCode,
      );

      reservations.respondWith(otaReservation({ otaCommissionPercentage: 150 }));
      expectApiError(
        await get({ reservationRef: RESERVATION_REF, roomId: ROOM_A }),
        409,
        new InvalidCommissionError(RESERVATION_REF, OTA_ID, 150).errorCode,
      );
    });

    it('424 MODULE2_UNAVAILABLE: Módulo 2 no responde', async () => {
      reservations.respondWith(new Module2UnavailableError(RESERVATION_REF));

      const response = await get({ reservationRef: RESERVATION_REF, roomId: ROOM_A });

      expectApiError(response, 424, 'MODULE2_UNAVAILABLE');
      expect(response.headers['cache-control']).toBe('no-store');
    });
  });
});
