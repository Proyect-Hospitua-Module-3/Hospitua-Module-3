// Feature 005 · Consultar tarifa dinámica
// T011: contrato GET-pricing-dynamic-rate.md (proveedor 005, consumidor Módulo 2).
// Comprueba la forma exacta de la respuesta y de cada error del contrato. El
// comportamiento de punta a punta (con el cliente HTTP real de 004) está en
// test/e2e/pricing/dynamic-rate.e2e-spec.ts.
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
const DECIMAL_2 = /^-?\d+\.\d{2}$/;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

describe('Contrato GET /pricing/dynamic-rate (005 → Módulo 2)', () => {
  let app: INestApplication;
  let baseRates: FakeBaseRates;
  let calendar: FakeSeasonCalendar;
  let adminToken: string;

  beforeEach(async () => {
    baseRates = new FakeBaseRates();
    calendar = new FakeSeasonCalendar();
    calendar.assign(['2026-12-24', '2026-12-25'], ALTA_ID);
    const quotes = new InMemoryLodgingQuoteRepository();

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
    adminToken = app
      .get(JwtService)
      .sign({ sub: 'f2d3b4a5-6c7d-4e8f-9012-3456789abcde', role: 'Administrador' });
  });

  afterEach(async () => {
    await app?.close();
  });

  const get = (query: Record<string, string>, token?: string) => {
    const call = request(app.getHttpServer()).get('/pricing/dynamic-rate').query(query);
    return token ? call.set('Authorization', `Bearer ${token}`) : call;
  };

  it('200: devuelve exactamente roomId, currency, nights y total (sección 4)', async () => {
    const response = await get({ roomId: ROOM_ID, date: '2026-12-24' });

    expect(response.status).toBe(200);
    expect(Object.keys(response.body).sort()).toEqual(['currency', 'nights', 'roomId', 'total']);
    for (const night of response.body.nights) {
      expect(Object.keys(night).sort()).toEqual(
        ['baseRate', 'date', 'dynamicRate', 'seasonAdjustmentPercent', 'seasonName'].sort(),
      );
    }
  });

  it('200: importes y porcentajes como texto con 2 decimales, nunca number', async () => {
    const response = await get({
      roomId: ROOM_ID,
      checkInDate: '2026-12-23',
      checkOutDate: '2026-12-26',
    });

    const decimals = [
      response.body.total,
      ...response.body.nights.flatMap((night: Record<string, string>) => [
        night.baseRate,
        night.seasonAdjustmentPercent,
        night.dynamicRate,
      ]),
    ];
    for (const value of decimals) {
      expect(typeof value).toBe('string');
      expect(value).toMatch(DECIMAL_2);
    }
  });

  it('200: ejemplo 1 del contrato (una noche en temporada alta)', async () => {
    const response = await get({ roomId: ROOM_ID, date: '2026-12-24' });

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
  });

  it('200: ejemplo 2 del contrato (rango, salida exclusiva, orden cronológico)', async () => {
    const response = await get({
      roomId: ROOM_ID,
      checkInDate: '2026-12-23',
      checkOutDate: '2026-12-26',
    });

    expect(response.body).toEqual({
      roomId: ROOM_ID,
      currency: 'COP',
      nights: [
        {
          date: '2026-12-23',
          baseRate: '300000.00',
          seasonName: 'Regular',
          seasonAdjustmentPercent: '0.00',
          dynamicRate: '300000.00',
        },
        {
          date: '2026-12-24',
          baseRate: '300000.00',
          seasonName: 'Alta',
          seasonAdjustmentPercent: '20.00',
          dynamicRate: '360000.00',
        },
        {
          date: '2026-12-25',
          baseRate: '300000.00',
          seasonName: 'Alta',
          seasonAdjustmentPercent: '20.00',
          dynamicRate: '360000.00',
        },
      ],
      total: '1020000.00',
    });
  });

  // Sección 5. MODULE2_UNAVAILABLE no se prueba aquí: solo aplica a la OTA (HU4, pendiente de 007).
  type ErrorCase = [status: number, errorCode: string, prepare: () => request.Test];
  const errorCases: [string, ...ErrorCase][] = [
    ['faltan parámetros', 400, 'INVALID_QUERY_PARAMS', () => get({ roomId: ROOM_ID })],
    [
      'date junto con el rango',
      400,
      'INVALID_QUERY_PARAMS',
      () =>
        get({
          roomId: ROOM_ID,
          date: '2026-12-24',
          checkInDate: '2026-12-24',
          checkOutDate: '2026-12-25',
        }),
    ],
    [
      'salida igual a la entrada',
      400,
      'INVALID_DATE_RANGE',
      () => get({ roomId: ROOM_ID, checkInDate: '2026-12-24', checkOutDate: '2026-12-24' }),
    ],
    [
      'token inválido',
      401,
      'UNAUTHENTICATED',
      () => get({ roomId: ROOM_ID, date: '2026-12-24' }, 'abc'),
    ],
    [
      'token de Administrador',
      403,
      'FORBIDDEN',
      () => get({ roomId: ROOM_ID, date: '2026-12-24' }, adminToken),
    ],
    [
      'Módulo 1 no conoce la habitación',
      404,
      'ROOM_NOT_FOUND',
      () => {
        baseRates.failures.set('2026-12-24', new RoomNotFoundError());
        return get({ roomId: ROOM_ID, date: '2026-12-24' });
      },
    ],
    [
      'Módulo 1 da una tarifa base en cero para una noche',
      424,
      'INVALID_BASE_RATE',
      () => {
        baseRates.rates.set('2026-12-24', '0.00');
        return get({ roomId: ROOM_ID, checkInDate: '2026-12-23', checkOutDate: '2026-12-26' });
      },
    ],
    [
      'Módulo 1 no responde',
      424,
      'MODULE1_UNAVAILABLE',
      () => {
        baseRates.failures.set('2026-12-24', new Module1UnavailableError());
        return get({ roomId: ROOM_ID, date: '2026-12-24' });
      },
    ],
    [
      'el calendario usa una temporada que no está en el catálogo',
      422,
      'UNEXPECTED_ERROR',
      () => {
        calendar.assign(['2026-12-24'], '11111111-2222-4333-8444-555555555555');
        return get({ roomId: ROOM_ID, date: '2026-12-24' });
      },
    ],
  ];

  it.each(errorCases)(
    '%s → %i %s con la forma ApiError y sin resultado parcial',
    async (_case, status, errorCode, prepare) => {
      const response = await prepare();

      expect(response.status).toBe(status);
      expect(response.body).toEqual({
        errorCode,
        message: expect.any(String),
        timestamp: expect.stringMatching(ISO_INSTANT),
        path: expect.stringContaining('/pricing/dynamic-rate'),
      });
    },
  );
});
