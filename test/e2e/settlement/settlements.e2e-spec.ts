// Feature 002 · Consultar liquidación (T008 y T014)
// GET /api/settlements de punta a punta para la OTA (HU1) y para Módulo 1 (HU2): HTTP →
// middlewares → guards JWT → caso de uso → respuesta. Las lecturas de liquidaciones,
// facturas y cotizaciones se reemplazan por dobles para que corra sin PostgreSQL (los
// adaptadores reales se prueban en test/integration/persistence/settlement). Para Módulo 1
// se usa el cliente HTTP real de 007 contra un Módulo 2 simulado.
process.env.JWT_SECRET = 'secreto-solo-para-pruebas';
process.env.JWT_EXPIRES_IN_SECONDS = '3600';

import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../../src/app.module';
import { LODGING_QUOTE_QUERY } from '../../../src/domain/ports/out/pricing/lodging-quote-query.port';
import { SETTLEMENT_INVOICE_QUERY } from '../../../src/domain/ports/out/settlement/settlement-invoice-query.port';
import { SETTLEMENT_QUERY } from '../../../src/domain/ports/out/settlement/settlement-query.port';
import { SETTLEMENT_REPOSITORY } from '../../../src/domain/ports/out/settlement/settlement.repository.port';
import { PrismaService } from '../../../src/infrastructure/adapters/out/persistence/prisma.service';
import { Module1HttpFixture } from '../../support/pricing/module1-http-fixture';
import {
  InMemoryLodgingQuotes,
  InMemorySettlementRepository,
  QUOTE_A,
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

const OTA_SUB = '0b8a4c1e-2d3f-4a5b-8c6d-7e8f9a0b1c2d';

describe('Consultar liquidación — OTA (e2e)', () => {
  let app: INestApplication;
  let settlements: InMemorySettlementQuery;
  let invoices: InMemorySettlementInvoices;
  let jwt: JwtService;
  let bookingToken: string;

  beforeEach(async () => {
    settlements = new InMemorySettlementQuery();
    invoices = new InMemorySettlementInvoices();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue({})
      .overrideProvider(SETTLEMENT_QUERY)
      .useValue(settlements)
      .overrideProvider(SETTLEMENT_INVOICE_QUERY)
      .useValue(invoices)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    jwt = app.get(JwtService);
    bookingToken = jwt.sign({ sub: OTA_SUB, role: 'OTA', otaId: OTA_ID });
  });

  afterEach(async () => {
    await app?.close();
  });

  const asOta = (reservationRef: string, token = bookingToken) =>
    request(app.getHttpServer())
      .get('/api/settlements')
      .query({ reservationRef })
      .set('Authorization', `Bearer ${token}`);

  // Igual salvo el timestamp, que cambia en cada respuesta.
  function withoutTimestamp(body: Record<string, unknown>): Record<string, unknown> {
    return { ...body, timestamp: undefined };
  }

  it('200: la OTA recibe las Final de las habitaciones con check-out, en orden de habitación y con su factura (escenario 1)', async () => {
    const roomB = finalSettlement({ roomId: ROOM_B, categoryRoom: 'SUITE' });
    const roomA = finalSettlement({ roomId: ROOM_A });
    settlements.settlements.push(roomB, roomA);
    invoices.emit(roomA, { invoiceNumber: 1042 });

    const response = await asOta(RESERVATION_REF);

    expect(response.status).toBe(200);
    expect(response.body.reservationRef).toBe(RESERVATION_REF);
    expect(response.body.settlements).toMatchObject([
      {
        roomId: ROOM_A,
        categoryRoom: 'DOBLE',
        settlementType: 'FINAL',
        breakdown: { dynamicAdjustmentAmount: '50000.00', netIncome: '637500.00' },
        invoice: { invoiceNumber: 1042, status: 'ISSUED' },
      },
      { roomId: ROOM_B, categoryRoom: 'SUITE', invoice: null },
    ]);
    expect(settlements.calls).toEqual([{ reservationRef: RESERVATION_REF, otaId: OTA_ID }]);
  });

  it('una habitación sin check-out no aparece: solo salen las que tienen liquidación Final (FR-002)', async () => {
    settlements.settlements.push(finalSettlement({ roomId: ROOM_A }));

    const response = await asOta(RESERVATION_REF);

    expect(response.body.settlements.map((item: { roomId: string }) => item.roomId)).toEqual([
      ROOM_A,
    ]);
  });

  it('anti-enumeración: sin check-out, reserva directa y reserva de otra OTA dan la misma respuesta 404 (escenarios 2 y 3)', async () => {
    settlements.settlements.push(
      directFinalSettlement({ reservationRef: 'RES-DIRECTA' }),
      finalSettlement({ reservationRef: 'RES-EXPEDIA', otaId: 'expedia' }),
    );

    const empty = await asOta('RES-SIN-CHECKOUT');
    const direct = await asOta('RES-DIRECTA');
    const foreign = await asOta('RES-EXPEDIA');

    for (const response of [empty, direct, foreign]) {
      expect(response.status).toBe(404);
      expect(response.body.errorCode).toBe('SETTLEMENT_NOT_FOUND');
    }
    const [emptyBody, directBody, foreignBody] = [empty, direct, foreign].map((response) => ({
      ...withoutTimestamp(response.body),
      path: undefined,
    }));
    expect(directBody).toEqual(emptyBody);
    expect(foreignBody).toEqual(emptyBody);
  });

  it('otra OTA no ve las liquidaciones de booking aunque conozca la reserva (FR-006, SC-002)', async () => {
    settlements.settlements.push(finalSettlement());
    const expediaToken = jwt.sign({ sub: OTA_SUB, role: 'OTA', otaId: 'expedia' });

    const response = await asOta(RESERVATION_REF, expediaToken);

    expect(response.status).toBe(404);
    expect(response.body.errorCode).toBe('SETTLEMENT_NOT_FOUND');
    expect(JSON.stringify(response.body)).not.toContain('750000');
  });

  it('401: token OTA sin claim otaId, aunque la reserva tenga liquidaciones (escenario 4)', async () => {
    settlements.settlements.push(finalSettlement());
    const withoutOtaId = jwt.sign({ sub: OTA_SUB, role: 'OTA' });

    const response = await asOta(RESERVATION_REF, withoutOtaId);

    expect(response.status).toBe(401);
    expect(response.body.errorCode).toBe('UNAUTHENTICATED');
    expect(settlements.calls).toEqual([]);
  });

  it('401: token vencido o firmado con otra clave (escenario 4)', async () => {
    const expired = jwt.sign({ sub: OTA_SUB, role: 'OTA', otaId: OTA_ID }, { expiresIn: -10 });
    const otherKey = jwt.sign(
      { sub: OTA_SUB, role: 'OTA', otaId: OTA_ID },
      { secret: 'otra-clave-distinta' },
    );

    for (const token of [expired, otherKey]) {
      const response = await asOta(RESERVATION_REF, token);
      expect(response.status).toBe(401);
      expect(response.body.errorCode).toBe('UNAUTHENTICATED');
    }
  });

  it('403: un Administrador no consulta liquidaciones como OTA (BR-006)', async () => {
    settlements.settlements.push(finalSettlement());
    const adminToken = jwt.sign({
      sub: 'f2d3b4a5-6c7d-4e8f-9012-3456789abcde',
      role: 'Administrador',
    });

    const response = await asOta(RESERVATION_REF, adminToken);

    expect(response.status).toBe(403);
    expect(response.body.errorCode).toBe('FORBIDDEN');
  });

  it('consultas repetidas devuelven el mismo cuerpo, sin recalcular (FR-008, SC-005)', async () => {
    const settlement = finalSettlement();
    settlements.settlements.push(settlement);
    invoices.emit(settlement);

    const first = await asOta(RESERVATION_REF);
    const second = await asOta(RESERVATION_REF);

    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);
  });

  it('todas las respuestas llevan Cache-Control: no-store y un X-Correlation-Id', async () => {
    settlements.settlements.push(finalSettlement());

    const ok = await asOta(RESERVATION_REF);
    const notFound = await asOta('RES-SIN-CHECKOUT');

    for (const response of [ok, notFound]) {
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.headers['x-correlation-id']).toEqual(expect.any(String));
    }
  });
});

describe('Consultar liquidación — Módulo 1 sin token (e2e)', () => {
  let moduleTwo: Module1HttpFixture;
  let app: INestApplication;
  let otaSettlements: InMemorySettlementQuery;
  let invoices: InMemorySettlementInvoices;
  let finals: InMemorySettlementRepository;

  // Respuesta de Módulo 2 (contrato CLIENT-get-reservation.md de 007).
  const otaReservationBody = {
    reservationRef: RESERVATION_REF,
    quoteIds: [QUOTE_A],
    channel: 'OTA',
    otaId: OTA_ID,
    otaConfirmationCode: 'BKG-88421',
    otaCommissionPercentage: 15,
  };

  beforeAll(async () => {
    moduleTwo = new Module1HttpFixture();
    await moduleTwo.start();
  });

  afterAll(async () => {
    await moduleTwo?.stop();
  });

  beforeEach(async () => {
    process.env.MODULE2_BASE_URL = moduleTwo.baseUrl;
    moduleTwo.requests = 0;
    moduleTwo.requestLog = [];
    moduleTwo.setReply({ status: 200, body: otaReservationBody });
    otaSettlements = new InMemorySettlementQuery();
    invoices = new InMemorySettlementInvoices();
    finals = new InMemorySettlementRepository();

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue({})
      .overrideProvider(SETTLEMENT_QUERY)
      .useValue(otaSettlements)
      .overrideProvider(SETTLEMENT_INVOICE_QUERY)
      .useValue(invoices)
      .overrideProvider(SETTLEMENT_REPOSITORY)
      .useValue(finals)
      .overrideProvider(LODGING_QUOTE_QUERY)
      .useValue(new InMemoryLodgingQuotes([storedQuote(QUOTE_A, ROOM_A)]))
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app?.close();
  });

  const asModule1 = (query: Record<string, string>) =>
    request(app.getHttpServer()).get('/api/settlements').query(query);

  it('200 INFORMATIVE: sin check-out, calcula la liquidación con la reserva de Módulo 2 y no la guarda (escenario 1)', async () => {
    const response = await asModule1({ reservationRef: RESERVATION_REF, roomId: ROOM_A }).set(
      'X-Correlation-Id',
      'corr-002-e2e',
    );

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      settlementType: 'INFORMATIVE',
      roomId: ROOM_A,
      categoryRoom: null,
      channel: 'OTA',
      otaId: OTA_ID,
      breakdown: {
        baseLodgingAmount: '700000.00',
        dynamicAdjustmentAmount: '50000.00',
        lodgingAmount: '750000.00',
        otaCommissionPercentage: '15.00',
        otaCommissionAmount: '112500.00',
        netIncome: '637500.00',
      },
      invoice: null,
    });
    // La reserva se pidió a Módulo 2 con el mismo id de correlación.
    expect(moduleTwo.requestLog).toHaveLength(1);
    expect(moduleTwo.requestLog[0].url).toBe(`/api/reservations/${RESERVATION_REF}`);
    expect(moduleTwo.requestLog[0].headers['x-correlation-id']).toBe('corr-002-e2e');
    expect(response.headers['x-correlation-id']).toBe('corr-002-e2e');
    expect(response.headers['cache-control']).toBe('no-store');
    expect(finals.inserts).toBe(0);
  });

  it('200 INFORMATIVE de canal directo cuando Módulo 2 no informa canal (escenario 2)', async () => {
    moduleTwo.setReply({
      status: 200,
      body: { reservationRef: RESERVATION_REF, quoteIds: [QUOTE_A], channel: null },
    });

    const response = await asModule1({ reservationRef: RESERVATION_REF, roomId: ROOM_A });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      settlementType: 'INFORMATIVE',
      channel: 'DIRECT',
      otaId: null,
      breakdown: { otaCommissionAmount: '0.00', netIncome: '750000.00' },
    });
  });

  it('200 FINAL: una habitación con check-out consultada sin categoryRoom, sin llamar a Módulo 2', async () => {
    const stored = finals.seed(finalSettlement({ roomId: ROOM_A }));
    invoices.emit(stored, { invoiceNumber: 1042 });

    const response = await asModule1({ reservationRef: RESERVATION_REF, roomId: ROOM_A });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      settlementType: 'FINAL',
      categoryRoom: 'DOBLE',
      invoice: { invoiceNumber: 1042 },
    });
    expect(moduleTwo.requests).toBe(0);
  });

  it('400: falta reservationRef o roomId, sin llamar a Módulo 2 (FR-013)', async () => {
    const queries: Array<Record<string, string>> = [
      { roomId: ROOM_A },
      { reservationRef: RESERVATION_REF },
    ];
    for (const query of queries) {
      const response = await asModule1(query);
      expect(response.status).toBe(400);
      expect(response.body.errorCode).toBe('INVALID_QUERY_PARAMS');
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.headers['x-correlation-id']).toEqual(expect.any(String));
    }
    expect(moduleTwo.requests).toBe(0);
  });

  it('sin token y sin roomId no revela información financiera de las reservas OTA (FR-013, SC-010)', async () => {
    otaSettlements.settlements.push(finalSettlement(), finalSettlement({ roomId: ROOM_B }));
    finals.seed(finalSettlement({ roomId: ROOM_A }));

    const response = await asModule1({ reservationRef: RESERVATION_REF });
    const text = JSON.stringify(response.body);

    expect(response.status).toBe(400);
    expect(response.body.errorCode).toBe('INVALID_QUERY_PARAMS');
    for (const amount of ['750000', '637500', '112500', '15.00']) {
      expect(text).not.toContain(amount);
    }
    expect(text).not.toContain(OTA_ID);
    // No se trató como consulta de OTA ni se leyó ninguna liquidación.
    expect(otaSettlements.calls).toEqual([]);
    expect(invoices.calls).toEqual([]);
  });

  it('404 RESERVATION_NOT_FOUND si Módulo 2 no tiene la reserva; 424 si Módulo 2 falla', async () => {
    moduleTwo.setReply({ status: 404, body: { errorCode: 'RESERVATION_NOT_FOUND' } });
    const notFound = await asModule1({ reservationRef: RESERVATION_REF, roomId: ROOM_A });

    moduleTwo.setReply({ status: 503 });
    const unavailable = await asModule1({ reservationRef: RESERVATION_REF, roomId: ROOM_A });

    expect(notFound.status).toBe(404);
    expect(notFound.body.errorCode).toBe('RESERVATION_NOT_FOUND');
    expect(unavailable.status).toBe(424);
    expect(unavailable.body.errorCode).toBe('MODULE2_UNAVAILABLE');
    for (const response of [notFound, unavailable]) {
      expect(response.headers['cache-control']).toBe('no-store');
    }
  });

  it('409 MISSING_COMMISSION: reserva OTA sin comisión, sin valores parciales (escenario 3)', async () => {
    moduleTwo.setReply({
      status: 200,
      body: { ...otaReservationBody, otaCommissionPercentage: null },
    });

    const response = await asModule1({ reservationRef: RESERVATION_REF, roomId: ROOM_A });

    expect(response.status).toBe(409);
    expect(response.body.errorCode).toBe('MISSING_COMMISSION');
    expect(response.body.breakdown).toBeUndefined();
  });
});
