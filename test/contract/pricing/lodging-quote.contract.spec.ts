// Feature 005 · Consultar tarifa dinámica
// T026: contrato POST-pricing-quotes.md (proveedor 005, consumidor Módulo 2).
// Comprueba la forma exacta de la respuesta y de cada error del contrato, y que ningún
// error deja una cotización guardada. El comportamiento de punta a punta (con el
// cliente HTTP real de 004) está en test/e2e/pricing/dynamic-rate.e2e-spec.ts.
process.env.JWT_SECRET = 'secreto-solo-para-pruebas';
process.env.JWT_EXPIRES_IN_SECONDS = '3600';
process.env.MODULE1_BASE_URL = 'http://localhost:3001';
process.env.MODULE1_TIMEOUT_MS = '500';
// 007: AppModule también arranca el cliente de Módulo 2.
process.env.MODULE2_BASE_URL = 'http://localhost:3002';
process.env.MODULE2_TIMEOUT_MS = '500';

import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../../src/app.module';
import { Module1UnavailableError } from '../../../src/domain/errors/pricing/module1-unavailable.error';
import { RoomNotFoundError } from '../../../src/domain/errors/pricing/room-not-found.error';
import { GET_BASE_RATE_USE_CASE } from '../../../src/domain/ports/in/pricing/get-base-rate.use-case';
import { GET_EFFECTIVE_SEASON_RULES_USE_CASE } from '../../../src/domain/ports/in/pricing/get-effective-season-rules.use-case';
import { RESOLVE_SEASON_BY_DATE_USE_CASE } from '../../../src/domain/ports/in/pricing/resolve-season-by-date.use-case';
import { LODGING_QUOTE_QUERY } from '../../../src/domain/ports/out/pricing/lodging-quote-query.port';
import { LODGING_QUOTE_REPOSITORY } from '../../../src/domain/ports/out/pricing/lodging-quote.repository.port';
import { PrismaService } from '../../../src/infrastructure/adapters/out/persistence/prisma.service';
import {
  ALTA_ID,
  FakeBaseRates,
  FakeSeasonCalendar,
  FakeSeasonRules,
  InMemoryLodgingQuoteRepository,
} from '../../support/pricing/fake-dynamic-rate-ports';

const ROOM_ID = '3f2b8c1e-5a47-4d09-9b6e-1c2d3e4f5a6b';
const STAY = { roomId: ROOM_ID, checkInDate: '2026-12-23', checkOutDate: '2026-12-26' };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DECIMAL_2 = /^\d+\.\d{2}$/;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

describe('Contrato POST /pricing/quotes (005 → Módulo 2)', () => {
  let app: INestApplication;
  let baseRates: FakeBaseRates;
  let calendar: FakeSeasonCalendar;
  let quotes: InMemoryLodgingQuoteRepository;
  let adminToken: string;
  let otaToken: string;

  beforeEach(async () => {
    baseRates = new FakeBaseRates();
    calendar = new FakeSeasonCalendar();
    calendar.assign(['2026-12-24', '2026-12-25'], ALTA_ID);
    quotes = new InMemoryLodgingQuoteRepository();

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue({})
      .overrideProvider(GET_BASE_RATE_USE_CASE)
      .useValue(baseRates)
      .overrideProvider(GET_EFFECTIVE_SEASON_RULES_USE_CASE)
      .useValue(new FakeSeasonRules())
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
  });

  const post = (body: object, token?: string) => {
    const call = request(app.getHttpServer()).post('/pricing/quotes').send(body);
    return token ? call.set('Authorization', `Bearer ${token}`) : call;
  };

  it('200: devuelve exactamente quoteId, currency, nightlyRates y lodgingAmount (sección 4)', async () => {
    const response = await post(STAY);

    expect(response.status).toBe(200);
    expect(Object.keys(response.body).sort()).toEqual(
      ['currency', 'lodgingAmount', 'nightlyRates', 'quoteId'].sort(),
    );
    for (const night of response.body.nightlyRates) {
      expect(Object.keys(night).sort()).toEqual(['date', 'rate']);
    }
  });

  it('200: quoteId es un UUID y los importes son texto con 2 decimales, nunca number', async () => {
    const response = await post(STAY);

    expect(response.body.quoteId).toMatch(UUID);
    const amounts = [
      response.body.lodgingAmount,
      ...response.body.nightlyRates.map((night: { rate: string }) => night.rate),
    ];
    for (const value of amounts) {
      expect(typeof value).toBe('string');
      expect(value).toMatch(DECIMAL_2);
    }
  });

  it('200: ejemplo del contrato (3 noches, salida exclusiva, orden cronológico)', async () => {
    const response = await post(STAY);

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
  });

  // Sección 5: en todos los casos de error no se guarda ninguna cotización.
  type ErrorCase = [status: number, errorCode: string, prepare: () => request.Test];
  const errorCases: [string, ...ErrorCase][] = [
    [
      'falta un campo del cuerpo',
      400,
      'INVALID_QUERY_PARAMS',
      () => post({ roomId: ROOM_ID, checkInDate: '2026-12-23' }),
    ],
    [
      'fecha que no existe',
      400,
      'INVALID_QUERY_PARAMS',
      () => post({ ...STAY, checkOutDate: '2026-02-30' }),
    ],
    [
      'salida igual a la entrada',
      400,
      'INVALID_DATE_RANGE',
      () => post({ ...STAY, checkOutDate: '2026-12-23' }),
    ],
    ['token de Administrador', 403, 'FORBIDDEN', () => post(STAY, adminToken)],
    ['token de OTA', 403, 'FORBIDDEN', () => post(STAY, otaToken)],
    [
      'Módulo 1 no conoce la habitación',
      404,
      'ROOM_NOT_FOUND',
      () => {
        baseRates.failures.set('2026-12-23', new RoomNotFoundError());
        return post(STAY);
      },
    ],
    [
      'Módulo 1 da una tarifa base en cero para una noche',
      424,
      'INVALID_BASE_RATE',
      () => {
        baseRates.rates.set('2026-12-25', '0.00');
        return post(STAY);
      },
    ],
    [
      'Módulo 1 no responde',
      424,
      'MODULE1_UNAVAILABLE',
      () => {
        baseRates.failures.set('2026-12-24', new Module1UnavailableError());
        return post(STAY);
      },
    ],
    [
      'falla la inserción',
      422,
      'UNEXPECTED_ERROR',
      () => {
        quotes.failure = new Error('fallo de la base de datos');
        return post(STAY);
      },
    ],
  ];

  it.each(errorCases)(
    '%s → %i %s con la forma ApiError y sin guardar nada',
    async (_case, status, errorCode, prepare) => {
      const response = await prepare();

      expect(response.status).toBe(status);
      expect(response.body).toEqual({
        errorCode,
        message: expect.any(String),
        timestamp: expect.stringMatching(ISO_INSTANT),
        path: expect.stringContaining('/pricing/quotes'),
      });
      expect(quotes.quotes.size).toBe(0);
    },
  );
});
