// Feature 005 · Consultar tarifa dinámica (T011, T013, T014, T022, T026, T030, T035)
// GET /pricing/dynamic-rate y POST /pricing/quotes de punta a punta: HTTP → guards →
// casos de uso → cliente HTTP real de 004 contra un Módulo 1 simulado y, para la OTA
// (HU4), cliente HTTP real de 007 contra un Módulo 2 simulado. 009, 011 y las
// cotizaciones guardadas se reemplazan por dobles, para que corra sin PostgreSQL; el
// archivo de acceso a datos real se prueba en test/integration.
process.env.JWT_SECRET = 'secreto-solo-para-pruebas';
process.env.JWT_EXPIRES_IN_SECONDS = '3600';

import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../../src/app.module';
import { GET_EFFECTIVE_SEASON_RULES_USE_CASE } from '../../../src/domain/ports/in/pricing/get-effective-season-rules.use-case';
import { RESOLVE_SEASON_BY_DATE_USE_CASE } from '../../../src/domain/ports/in/pricing/resolve-season-by-date.use-case';
import {
  LODGING_QUOTE_QUERY,
  LodgingQuoteQueryPort,
} from '../../../src/domain/ports/out/pricing/lodging-quote-query.port';
import { LODGING_QUOTE_REPOSITORY } from '../../../src/domain/ports/out/pricing/lodging-quote.repository.port';
import { PrismaService } from '../../../src/infrastructure/adapters/out/persistence/prisma.service';
import {
  ALTA_ID,
  FakeSeasonCalendar,
  FakeSeasonRules,
  InMemoryLodgingQuoteRepository,
} from '../../support/pricing/fake-dynamic-rate-ports';
import { Module1HttpFixture } from '../../support/pricing/module1-http-fixture';
import { Module1RatesServer } from '../../support/pricing/module1-rates-server';

const ROOM_ID = '3f2b8c1e-5a47-4d09-9b6e-1c2d3e4f5a6b';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

describe('Tarifa dinámica y cotización (e2e)', () => {
  let app: INestApplication;
  let module1: Module1RatesServer;
  // Módulo 2 simulado: responde GET /api/reservations/{ref} (contrato CLIENT-get-reservation de 007).
  let module2: Module1HttpFixture;
  let rules: FakeSeasonRules;
  let calendar: FakeSeasonCalendar;
  let quotes: InMemoryLodgingQuoteRepository;
  let adminToken: string;
  let otaToken: string;

  // App nueva en cada prueba: el circuit breaker de 004 no arrastra fallos entre pruebas.
  beforeEach(async () => {
    module1 = new Module1RatesServer();
    await module1.start();
    process.env.MODULE1_BASE_URL = module1.baseUrl;
    process.env.MODULE1_TIMEOUT_MS = '500';
    module2 = new Module1HttpFixture();
    await module2.start();
    module2.setReply({ status: 404, body: {} });
    process.env.MODULE2_BASE_URL = module2.baseUrl;
    process.env.MODULE2_TIMEOUT_MS = '500';

    rules = new FakeSeasonRules();
    calendar = new FakeSeasonCalendar();
    calendar.assign(['2026-12-24', '2026-12-25'], ALTA_ID);
    quotes = new InMemoryLodgingQuoteRepository();

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue({})
      .overrideProvider(GET_EFFECTIVE_SEASON_RULES_USE_CASE)
      .useValue(rules)
      .overrideProvider(RESOLVE_SEASON_BY_DATE_USE_CASE)
      .useValue(calendar)
      .overrideProvider(LODGING_QUOTE_REPOSITORY)
      .useValue(quotes)
      .overrideProvider(LODGING_QUOTE_QUERY)
      .useValue(quotes)
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
    await module1?.stop();
    await module2?.stop();
  });

  const dynamicRate = (query: Record<string, string>) =>
    request(app.getHttpServer()).get('/pricing/dynamic-rate').query(query);
  const createQuote = (body: unknown) =>
    request(app.getHttpServer())
      .post('/pricing/quotes')
      .send(body as object);

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

  describe('GET /pricing/dynamic-rate', () => {
    it('200: una noche en temporada alta (contrato, ejemplo 1) (T011)', async () => {
      const response = await dynamicRate({ roomId: ROOM_ID, date: '2026-12-24' });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        roomId: ROOM_ID,
        currency: 'COP',
        nights: [
          {
            date: '2026-12-24',
            baseRate: '300000.00',
            seasonName: 'Alta',
            seasonAdjustmentPercent: '20.00',
            dynamicRate: '360000.00',
          },
        ],
        total: '360000.00',
      });
      expect(module1.requests).toEqual([{ roomId: ROOM_ID, date: '2026-12-24' }]);
    });

    it('200: estancia que cruza de Regular a Alta (contrato, ejemplo 2) (T022)', async () => {
      const response = await dynamicRate({
        roomId: ROOM_ID,
        checkInDate: '2026-12-23',
        checkOutDate: '2026-12-26',
      });

      expect(response.status).toBe(200);
      expect(
        response.body.nights.map((n: { date: string; seasonName: string; dynamicRate: string }) => [
          n.date,
          n.seasonName,
          n.dynamicRate,
        ]),
      ).toEqual([
        ['2026-12-23', 'Regular', '300000.00'],
        ['2026-12-24', 'Alta', '360000.00'],
        ['2026-12-25', 'Alta', '360000.00'],
      ]);
      expect(response.body.total).toBe('1020000.00');
      // La noche del 26 (salida) no se cobra.
      expect(module1.requests.map((r) => r.date).sort()).toEqual([
        '2026-12-23',
        '2026-12-24',
        '2026-12-25',
      ]);
    });

    it('no guarda nada: la consulta es solo de lectura (FR-007)', async () => {
      await dynamicRate({ roomId: ROOM_ID, date: '2026-12-24' }).expect(200);

      expect(quotes.quotes.size).toBe(0);
    });

    it('sin token, reservationRef se ignora (llamada interna de Módulo 2)', async () => {
      const response = await dynamicRate({
        roomId: ROOM_ID,
        date: '2026-12-24',
        reservationRef: 'RES-000123',
      });

      expect(response.status).toBe(200);
      expect(module2.requests).toBe(0);
    });

    it('400 INVALID_DATE_RANGE sin llamar a Módulo 1', async () => {
      const response = await dynamicRate({
        roomId: ROOM_ID,
        checkInDate: '2026-12-26',
        checkOutDate: '2026-12-23',
      });

      expectApiError(response, 400, 'INVALID_DATE_RANGE', '/pricing/dynamic-rate');
      expect(module1.requests).toHaveLength(0);
    });

    it.each<[string, string]>([
      ['sin roomId', 'date=2026-12-24'],
      ['roomId que no es UUID', 'roomId=101&date=2026-12-24'],
      [
        'date junto con el rango',
        `roomId=${ROOM_ID}&date=2026-12-24&checkInDate=2026-12-24&checkOutDate=2026-12-25`,
      ],
      ['solo checkInDate', `roomId=${ROOM_ID}&checkInDate=2026-12-24`],
      ['fecha que no existe', `roomId=${ROOM_ID}&date=2026-02-30`],
      ['parámetro repetido', `roomId=${ROOM_ID}&date=2026-12-24&date=2026-12-25`],
    ])('400 INVALID_QUERY_PARAMS: %s', async (_, queryString) => {
      const response = await request(app.getHttpServer()).get(
        `/pricing/dynamic-rate?${queryString}`,
      );

      expectApiError(response, 400, 'INVALID_QUERY_PARAMS', '/pricing/dynamic-rate');
      expect(module1.requests).toHaveLength(0);
    });

    it('404 ROOM_NOT_FOUND cuando Módulo 1 no conoce la habitación (T014)', async () => {
      module1.replies.set('2026-12-24', { kind: 'roomNotFound' });

      const response = await dynamicRate({ roomId: ROOM_ID, date: '2026-12-24' });

      expectApiError(response, 404, 'ROOM_NOT_FOUND', '/pricing/dynamic-rate');
    });

    it('424 INVALID_BASE_RATE si Módulo 1 da una tarifa en cero para alguna noche (T014)', async () => {
      module1.replies.set('2026-12-25', { kind: 'rate', baseRate: '0.00' });

      const response = await dynamicRate({
        roomId: ROOM_ID,
        checkInDate: '2026-12-23',
        checkOutDate: '2026-12-26',
      });

      expectApiError(response, 424, 'INVALID_BASE_RATE', '/pricing/dynamic-rate');
      expect(response.body.nights).toBeUndefined();
    });

    it('424 MODULE1_UNAVAILABLE si Módulo 1 falla en una noche: sin resultado parcial (T014, T020)', async () => {
      module1.replies.set('2026-12-24', { kind: 'unavailable' });

      const response = await dynamicRate({
        roomId: ROOM_ID,
        checkInDate: '2026-12-23',
        checkOutDate: '2026-12-26',
      });

      expectApiError(response, 424, 'MODULE1_UNAVAILABLE', '/pricing/dynamic-rate');
      expect(response.body.nights).toBeUndefined();
    });

    it('422 UNEXPECTED_ERROR si el calendario usa una temporada que no está en el catálogo', async () => {
      calendar.assign(['2026-12-24'], '99999999-9999-4999-8999-999999999999');

      const response = await dynamicRate({ roomId: ROOM_ID, date: '2026-12-24' });

      expectApiError(response, 422, 'UNEXPECTED_ERROR', '/pricing/dynamic-rate');
    });

    it('401 UNAUTHENTICATED con un token inválido', async () => {
      const response = await dynamicRate({ roomId: ROOM_ID, date: '2026-12-24' }).set(
        'Authorization',
        'Bearer token-falso',
      );

      expectApiError(response, 401, 'UNAUTHENTICATED', '/pricing/dynamic-rate');
      expect(module1.requests).toHaveLength(0);
    });

    it('403 FORBIDDEN con token de Administrador, sin llamar a Módulo 1 ni a Módulo 2', async () => {
      const response = await dynamicRate({
        roomId: ROOM_ID,
        date: '2026-12-24',
        reservationRef: 'RES-000123',
      }).set('Authorization', `Bearer ${adminToken}`);

      expectApiError(response, 403, 'FORBIDDEN', '/pricing/dynamic-rate');
      expect(module1.requests).toHaveLength(0);
      expect(module2.requests).toBe(0);
    });
  });

  describe('GET /pricing/dynamic-rate — la OTA (HU4, T035)', () => {
    const RESERVATION_REF = 'RES-000123';
    const STAY = { roomId: ROOM_ID, checkInDate: '2026-12-23', checkOutDate: '2026-12-26' };

    // Como en la realidad: Módulo 2 cotizó la habitación con el POST y guardó el quoteId
    // en la reserva, que Módulo 2 simulado devuelve a la 007.
    async function otaReservation(changes: Record<string, unknown> = {}): Promise<void> {
      const quote = await createQuote(STAY).expect(200);
      module2.setReply({
        status: 200,
        body: {
          reservationRef: RESERVATION_REF,
          quoteIds: [quote.body.quoteId],
          channel: 'OTA',
          otaId: 'booking',
          otaConfirmationCode: 'BK-778899',
          otaCommissionPercentage: 15,
          ...changes,
        },
      });
    }

    const asOta = (query: Record<string, string>) =>
      dynamicRate(query).set('Authorization', `Bearer ${otaToken}`);

    it('200: habitación de una reserva propia, igual que para Módulo 2 (HU4, escenario 1)', async () => {
      await otaReservation();

      const response = await asOta({ ...STAY, reservationRef: RESERVATION_REF });
      const internal = await dynamicRate(STAY);

      expect(response.status).toBe(200);
      expect(response.body).toEqual(internal.body);
      expect(response.body.total).toBe('1020000.00');
      expect(module2.requestLog[0]).toMatchObject({
        method: 'GET',
        url: `/api/reservations/${RESERVATION_REF}`,
      });
    });

    it.each<[string, () => Promise<void>]>([
      ['reserva de otra OTA', () => otaReservation({ otaId: 'expedia' })],
      [
        'reserva del canal directo',
        () =>
          otaReservation({ channel: 'DIRECT', otaId: undefined, otaConfirmationCode: undefined }),
      ],
      [
        'reserva que no incluye la habitación',
        () => otaReservation({ quoteIds: ['c9d0e1f2-a3b4-4c5d-8e6f-7a8b9c0d1e2f'] }),
      ],
      ['reserva inexistente (404 de Módulo 2)', async () => module2.setReply({ status: 404 })],
    ])(
      '403 FORBIDDEN con %s: mismo cuerpo y sin llamar a Módulo 1 (HU4, escenario 2)',
      async (_, prepare) => {
        await prepare();
        const module1Calls = module1.requests.length;

        const response = await asOta({ ...STAY, reservationRef: RESERVATION_REF });

        expectApiError(response, 403, 'FORBIDDEN', '/pricing/dynamic-rate');
        expect(response.body.message).toBe(
          'No tienes permiso para consultar la tarifa de esta habitación.',
        );
        expect(module1.requests).toHaveLength(module1Calls);
      },
    );

    it('400 INVALID_QUERY_PARAMS si la OTA no envía reservationRef, sin consultar a Módulo 2', async () => {
      const response = await asOta(STAY);

      expectApiError(response, 400, 'INVALID_QUERY_PARAMS', '/pricing/dynamic-rate');
      expect(module2.requests).toBe(0);
    });

    it('424 MODULE2_UNAVAILABLE si Módulo 2 falla al verificar la reserva, sin resultado', async () => {
      module2.setReply({ status: 503, body: {} });

      const response = await asOta({ ...STAY, reservationRef: RESERVATION_REF });

      expectApiError(response, 424, 'MODULE2_UNAVAILABLE', '/pricing/dynamic-rate');
      expect(response.body.nights).toBeUndefined();
      expect(module1.requests).toHaveLength(0);
    });
  });

  describe('POST /pricing/quotes', () => {
    const STAY = { roomId: ROOM_ID, checkInDate: '2026-12-23', checkOutDate: '2026-12-26' };

    it('200: guarda la cotización y devuelve quoteId, noches y total (T026)', async () => {
      const response = await createQuote(STAY);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        quoteId: expect.stringMatching(UUID),
        currency: 'COP',
        nightlyRates: [
          { date: '2026-12-23', rate: '300000.00' },
          { date: '2026-12-24', rate: '360000.00' },
          { date: '2026-12-25', rate: '360000.00' },
        ],
        lodgingAmount: '1020000.00',
      });

      // 007 la lee con el puerto de solo lectura, con la tarifa base de cada noche.
      const query = app.get<LodgingQuoteQueryPort>(LODGING_QUOTE_QUERY);
      const [saved] = await query.findByIds([response.body.quoteId]);
      expect(saved.lodgingAmount).toBe('1020000.00');
      expect(saved.nights.map((n) => n.baseRate)).toEqual(['300000.00', '300000.00', '300000.00']);
    });

    it('cotiza lo mismo que muestra la consulta de tarifa dinámica', async () => {
      const consulted = await dynamicRate(STAY).expect(200);

      const quoted = await createQuote(STAY).expect(200);

      expect(quoted.body.lodgingAmount).toBe(consulted.body.total);
      expect(quoted.body.nightlyRates.map((n: { rate: string }) => n.rate)).toEqual(
        consulted.body.nights.map((n: { dynamicRate: string }) => n.dynamicRate),
      );
    });

    it('la cotización guardada no cambia si después cambia la regla de temporada (SC-007)', async () => {
      const { body } = await createQuote(STAY).expect(200);
      rules.setAdjustment(ALTA_ID, '50.00');

      const [saved] = await app
        .get<LodgingQuoteQueryPort>(LODGING_QUOTE_QUERY)
        .findByIds([body.quoteId]);
      const consultedNow = await dynamicRate(STAY).expect(200);

      expect(saved.lodgingAmount).toBe('1020000.00');
      expect(consultedNow.body.total).toBe('1200000.00');
    });

    it('dos solicitudes iguales crean dos cotizaciones (sin idempotencia)', async () => {
      const first = await createQuote(STAY).expect(200);
      const second = await createQuote(STAY).expect(200);

      expect(first.body.quoteId).not.toBe(second.body.quoteId);
      expect(quotes.quotes.size).toBe(2);
    });

    it.each([
      ['un JWT de OTA', () => `Bearer ${otaToken}`],
      ['un JWT de Administrador', () => `Bearer ${adminToken}`],
      ['un token inválido', () => 'Bearer token-falso'],
    ])(
      '403 FORBIDDEN con %s, aunque el cuerpo esté mal, y sin guardar (T030)',
      async (_, header) => {
        for (const body of [STAY, {}]) {
          const response = await createQuote(body).set('Authorization', header());

          expectApiError(response, 403, 'FORBIDDEN', '/pricing/quotes');
        }
        expect(module1.requests).toHaveLength(0);
        expect(quotes.quotes.size).toBe(0);
      },
    );

    it('400 INVALID_DATE_RANGE sin guardar', async () => {
      const response = await createQuote({ ...STAY, checkOutDate: '2026-12-23' });

      expectApiError(response, 400, 'INVALID_DATE_RANGE', '/pricing/quotes');
      expect(quotes.quotes.size).toBe(0);
    });

    it.each<[string, unknown]>([
      ['sin cuerpo', undefined],
      ['cuerpo que es una lista', [STAY]],
      ['roomId vacío', { ...STAY, roomId: '' }],
      ['sin checkOutDate', { roomId: ROOM_ID, checkInDate: '2026-12-23' }],
      ['roomId como número', { ...STAY, roomId: 101 }],
      ['fecha que no existe', { ...STAY, checkInDate: '2026-02-30' }],
    ])('400 INVALID_QUERY_PARAMS: %s, sin guardar', async (_, body) => {
      const response = await createQuote(body);

      expectApiError(response, 400, 'INVALID_QUERY_PARAMS', '/pricing/quotes');
      expect(module1.requests).toHaveLength(0);
      expect(quotes.quotes.size).toBe(0);
    });

    it.each<[string, number, string, () => void]>([
      [
        'la habitación no existe',
        404,
        'ROOM_NOT_FOUND',
        () => module1.replies.set('2026-12-23', { kind: 'roomNotFound' }),
      ],
      [
        'una noche tiene tarifa en cero',
        424,
        'INVALID_BASE_RATE',
        () => module1.replies.set('2026-12-25', { kind: 'rate', baseRate: '0.00' }),
      ],
      [
        'Módulo 1 no responde en una noche',
        424,
        'MODULE1_UNAVAILABLE',
        () => module1.replies.set('2026-12-24', { kind: 'unavailable' }),
      ],
    ])('si %s: %i %s y no guarda nada (FR-015)', async (_, status, errorCode, arrange) => {
      arrange();

      const response = await createQuote(STAY);

      expectApiError(response, status, errorCode, '/pricing/quotes');
      expect(quotes.quotes.size).toBe(0);
    });
  });
});
