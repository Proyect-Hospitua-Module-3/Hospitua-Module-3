// Feature 004 · Consultar tarifa base
// Flujo de punta a punta desde el puerto interno de pricing hasta el cliente HTTP
// real de Módulo 1. El servicio externo se sustituye por un servidor HTTP local.
const ENV_KEYS = [
  'MODULE1_BASE_URL',
  'MODULE1_TIMEOUT_MS',
  'JWT_SECRET',
  'JWT_EXPIRES_IN_SECONDS',
] as const;
const originalEnvironment = Object.fromEntries(
  ENV_KEYS.map((key) => [key, process.env[key]]),
) as Record<(typeof ENV_KEYS)[number], string | undefined>;
process.env.JWT_SECRET = 'secreto-solo-para-pruebas';
process.env.JWT_EXPIRES_IN_SECONDS = '3600';

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../../src/app.module';
import { InvalidBaseRateQueryError } from '../../../src/domain/errors/pricing/invalid-base-rate-query.error';
import { MalformedBaseRateResponseError } from '../../../src/domain/errors/pricing/malformed-base-rate-response.error';
import { Module1UnavailableError } from '../../../src/domain/errors/pricing/module1-unavailable.error';
import { RoomNotFoundError } from '../../../src/domain/errors/pricing/room-not-found.error';
import {
  GET_BASE_RATE_USE_CASE,
  GetBaseRateUseCase,
} from '../../../src/domain/ports/in/pricing/get-base-rate.use-case';
import { PrismaService } from '../../../src/infrastructure/adapters/out/persistence/prisma.service';
import { Module1HttpFixture } from '../../support/pricing/module1-http-fixture';

const ROOM_ID = '550e8400-e29b-41d4-a716-446655440000';
const DATE = '2026-10-08';

function restoreEnvironment(environment: Record<string, string | undefined>): void {
  for (const key of ENV_KEYS) {
    const value = environment[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

describe('GetBaseRateUseCase (e2e)', () => {
  let app!: INestApplication;
  let fixture!: Module1HttpFixture;
  let useCase!: GetBaseRateUseCase;
  let environmentBeforeTest: Record<(typeof ENV_KEYS)[number], string | undefined>;

  beforeEach(async () => {
    environmentBeforeTest = Object.fromEntries(
      ENV_KEYS.map((key) => [key, process.env[key]]),
    ) as Record<(typeof ENV_KEYS)[number], string | undefined>;
    fixture = new Module1HttpFixture();
    try {
      await fixture.start();
      process.env.MODULE1_BASE_URL = fixture.baseUrl;
      process.env.MODULE1_TIMEOUT_MS = '500';

      const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
        // 004 no usa persistencia; sustituir Prisma evita conectar a PostgreSQL al arrancar.
        .overrideProvider(PrismaService)
        .useValue({})
        .compile();
      app = moduleRef.createNestApplication();
      await app.init();
      useCase = app.get<GetBaseRateUseCase>(GET_BASE_RATE_USE_CASE);
    } catch (error) {
      await closeResources().catch(() => undefined);
      restoreEnvironment(environmentBeforeTest);
      throw error;
    }
  });

  afterEach(async () => {
    try {
      await closeResources();
    } finally {
      restoreEnvironment(environmentBeforeTest);
    }
  });

  afterAll(() => restoreEnvironment(originalEnvironment));

  async function closeResources(): Promise<void> {
    const activeApp = app;
    const activeFixture = fixture;
    app = undefined as unknown as INestApplication;
    fixture = undefined as unknown as Module1HttpFixture;
    try {
      await activeApp?.close();
    } finally {
      await activeFixture?.stop();
    }
  }

  function expectRequestsToModule1(count: number): void {
    expect(fixture.requestLog).toHaveLength(count);
    for (const upstreamRequest of fixture.requestLog) {
      const url = new URL(upstreamRequest.url, fixture.baseUrl);
      expect(upstreamRequest.method).toBe('GET');
      expect(url.pathname).toBe(`/api/rooms/${ROOM_ID}/base-rate`);
      expect([...url.searchParams.entries()]).toEqual([['date', DATE]]);
    }
  }

  it('consulta la tarifa de Módulo 1 y devuelve el importe y la moneda', async () => {
    fixture.setReply({
      status: 200,
      body: { roomId: ROOM_ID, date: DATE, baseRate: '250000.00', currency: 'COP' },
    });

    const rate = await useCase.execute(ROOM_ID, DATE);

    expect(rate.amount.toString()).toBe('250000.00');
    expect(rate.currency).toBe('COP');
    expectRequestsToModule1(1);
  });

  it.each([
    ['UUID inválido', 'no-es-un-uuid', DATE],
    ['fecha imposible', ROOM_ID, '2026-02-30'],
  ])(
    'rechaza localmente una consulta con %s sin llamar a Módulo 1',
    async (_case, roomId, date) => {
      await expect(useCase.execute(roomId, date)).rejects.toBeInstanceOf(InvalidBaseRateQueryError);
      expectRequestsToModule1(0);
    },
  );

  it('consulta de nuevo la misma habitación y fecha sin reutilizar una tarifa anterior', async () => {
    fixture.setReplies([
      {
        status: 200,
        body: { roomId: ROOM_ID, date: DATE, baseRate: '250000.00', currency: 'COP' },
      },
      {
        status: 200,
        body: { roomId: ROOM_ID, date: DATE, baseRate: '275000.00', currency: 'COP' },
      },
    ]);

    const first = await useCase.execute(ROOM_ID, DATE);
    const second = await useCase.execute(ROOM_ID, DATE);

    expect(first.amount.toString()).toBe('250000.00');
    expect(second.amount.toString()).toBe('275000.00');
    expectRequestsToModule1(2);
  });

  it('propaga ROOM_NOT_FOUND cuando Módulo 1 no encuentra la habitación', async () => {
    fixture.setReply({
      status: 404,
      body: { errorCode: 'ROOM_NOT_FOUND', message: 'Habitación inexistente' },
    });

    let caught: unknown;
    try {
      await useCase.execute(ROOM_ID, DATE);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(RoomNotFoundError);
    expect(caught).toMatchObject({ errorCode: 'ROOM_NOT_FOUND' });
    expectRequestsToModule1(1);
  });

  it.each([
    ['dependencia no disponible', { status: 503, body: {} }, Module1UnavailableError],
    [
      'respuesta inválida',
      { status: 200, body: { roomId: ROOM_ID, date: DATE, baseRate: 250000 } },
      MalformedBaseRateResponseError,
    ],
  ])('propaga MODULE1_UNAVAILABLE ante %s', async (_case, reply, ExpectedError) => {
    fixture.setReply(reply);

    let caught: unknown;
    try {
      await useCase.execute(ROOM_ID, DATE);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ExpectedError);
    expect(caught).toMatchObject({ errorCode: 'MODULE1_UNAVAILABLE' });
    expectRequestsToModule1(1);
  });
});
