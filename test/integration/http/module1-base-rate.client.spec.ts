// Feature 004 · Consultar tarifa base
import { ConfigService } from '@nestjs/config';
import { HttpModule, HttpService } from '@nestjs/axios';
import { Test, TestingModule } from '@nestjs/testing';
import { Module1UnavailableError } from '../../../src/domain/errors/pricing/module1-unavailable.error';
import { InvalidBaseRateError } from '../../../src/domain/errors/pricing/invalid-base-rate.error';
import { RoomNotFoundError } from '../../../src/domain/errors/pricing/room-not-found.error';
import { Module1BaseRateClient } from '../../../src/infrastructure/adapters/out/http/module1-base-rate.client';
import { Module1HttpFixture, Module1Reply } from '../../support/pricing/module1-http-fixture';

const ROOM_ID = '550e8400-e29b-41d4-a716-446655440000';
const DATE = '2026-10-08';
const VALID_BODY = { roomId: ROOM_ID, date: DATE, baseRate: '250000.00', currency: 'COP' };

describe('Module1BaseRateClient HTTP integration', () => {
  let fixture: Module1HttpFixture;
  let moduleRef: TestingModule;
  let client: Module1BaseRateClient;

  async function createClient(): Promise<void> {
    moduleRef = await Test.createTestingModule({
      imports: [HttpModule.register({})],
      providers: [
        Module1BaseRateClient,
        {
          provide: ConfigService,
          useValue: {
            get: (name: string) =>
              name === 'MODULE1_BASE_URL'
                ? fixture.baseUrl
                : name === 'MODULE1_TIMEOUT_MS'
                  ? '500'
                  : undefined,
          },
        },
      ],
    }).compile();
    client = moduleRef.get(Module1BaseRateClient);
  }

  beforeEach(async () => {
    fixture = new Module1HttpFixture();
    await fixture.start();
    fixture.setReply({ status: 200, body: VALID_BODY });
    await createClient();
  });

  afterEach(async () => {
    jest.useRealTimers();
    await moduleRef?.close();
    await fixture.stop();
  });

  it('gets a current rate on every request and ignores extra success fields', async () => {
    fixture.setReply({ status: 200, body: { ...VALID_BODY, ignored: 'field' } });

    const rate = await client.getBaseRate(ROOM_ID, DATE);

    expect(rate.amount.toString()).toBe('250000.00');
    expect(fixture.requests).toBe(1);
  });

  it.each([
    ['250000', '250000.00'],
    ['250000.5', '250000.50'],
    ['250000.50', '250000.50'],
    ['250000.500', '250000.50'],
  ])('accepts baseRate %s at scale 2', async (baseRate, expected) => {
    fixture.setReply({ status: 200, body: { ...VALID_BODY, baseRate } });

    const rate = await client.getBaseRate(ROOM_ID, DATE);

    expect(rate.amount.toString()).toBe(expected);
  });

  it('makes two upstream requests for identical queries without caching or persistence', async () => {
    fixture.setReplies([
      { status: 200, body: VALID_BODY },
      { status: 200, body: { ...VALID_BODY, baseRate: '275000.00' } },
    ]);

    const first = await client.getBaseRate(ROOM_ID, DATE);
    const second = await client.getBaseRate(ROOM_ID, DATE);

    expect(first.amount.toString()).toBe('250000.00');
    expect(second.amount.toString()).toBe('275000.00');
    expect(fixture.requests).toBe(2);
  });

  it('maps structured ROOM_NOT_FOUND, including additional fields, without opening the circuit', async () => {
    fixture.setReply({
      status: 404,
      body: { errorCode: 'ROOM_NOT_FOUND', message: 'missing', details: { source: 'M1' } },
    });

    await expect(client.getBaseRate(ROOM_ID, DATE)).rejects.toBeInstanceOf(RoomNotFoundError);
    fixture.setReply({ status: 200, body: VALID_BODY });
    await expect(client.getBaseRate(ROOM_ID, DATE)).resolves.toBeDefined();
    expect(fixture.requests).toBe(2);
  });

  it('maps non-positive decimal amounts to InvalidBaseRateError without opening the circuit', async () => {
    fixture.setReply({ status: 200, body: { ...VALID_BODY, baseRate: '0.00' } });

    await expect(client.getBaseRate(ROOM_ID, DATE)).rejects.toBeInstanceOf(InvalidBaseRateError);
    fixture.setReply({ status: 200, body: VALID_BODY });
    await expect(client.getBaseRate(ROOM_ID, DATE)).resolves.toBeDefined();
    expect(fixture.requests).toBe(2);
  });

  it.each([
    ['404 without structured body', { status: 404 }],
    ['403 response', { status: 403, body: {} }],
    [
      '403 with a ROOM_NOT_FOUND body',
      { status: 403, body: { errorCode: 'ROOM_NOT_FOUND', message: 'missing' } },
    ],
    ['plus-signed amount', { status: 200, body: { ...VALID_BODY, baseRate: '+250000.00' } }],
    ['5xx response', { status: 503, body: {} }],
    ['non-JSON body', { status: 200, rawBody: '<html>error</html>' }],
    ['missing fields', { status: 200, body: { roomId: ROOM_ID } }],
    ['wrong field type', { status: 200, body: { ...VALID_BODY, date: 22 } }],
    ['numeric amount instead of text', { status: 200, body: { ...VALID_BODY, baseRate: 250000 } }],
    ['non-decimal amount', { status: 200, body: { ...VALID_BODY, baseRate: '25e4' } }],
    [
      'amount with more than two significant decimal places',
      { status: 200, body: { ...VALID_BODY, baseRate: '250000.505' } },
    ],
    ['wrong currency', { status: 200, body: { ...VALID_BODY, currency: 'USD' } }],
    [
      'mismatched room echo',
      {
        status: 200,
        body: { ...VALID_BODY, roomId: '550e8400-e29b-41d4-a716-446655440001' },
      },
    ],
    ['mismatched date echo', { status: 200, body: { ...VALID_BODY, date: '2026-10-09' } }],
  ] as Array<[string, Module1Reply]>)('maps %s to a dependency failure', async (_label, reply) => {
    fixture.setReply(reply);

    await expect(client.getBaseRate(ROOM_ID, DATE)).rejects.toMatchObject({
      errorCode: 'MODULE1_UNAVAILABLE',
    });
  });

  it('treats a response beyond 500 ms as a dependency failure', async () => {
    fixture.setReply({ status: 200, body: VALID_BODY, delayMs: 600 });

    await expect(client.getBaseRate(ROOM_ID, DATE)).rejects.toBeInstanceOf(Module1UnavailableError);
  });

  it('does not open after 4 failures, a success, then 1 failure', async () => {
    fixture.setReplies([
      ...Array.from({ length: 4 }, () => ({ status: 503, body: {} })),
      { status: 200, body: VALID_BODY },
      { status: 503, body: {} },
      { status: 200, body: VALID_BODY },
    ]);

    for (let failure = 0; failure < 4; failure += 1) {
      await expect(client.getBaseRate(ROOM_ID, DATE)).rejects.toBeInstanceOf(
        Module1UnavailableError,
      );
    }
    await expect(client.getBaseRate(ROOM_ID, DATE)).resolves.toBeDefined();
    await expect(client.getBaseRate(ROOM_ID, DATE)).rejects.toBeInstanceOf(Module1UnavailableError);
    await expect(client.getBaseRate(ROOM_ID, DATE)).resolves.toBeDefined();
    expect(fixture.requests).toBe(7);
  });

  it.each([
    ['ROOM_NOT_FOUND', { status: 404, body: { errorCode: 'ROOM_NOT_FOUND', message: 'missing' } }],
    ['INVALID_BASE_RATE', { status: 200, body: { ...VALID_BODY, baseRate: '0.00' } }],
  ] as Array<[string, Module1Reply]>)(
    'does not count %s as a consecutive dependency failure',
    async (label, businessReply) => {
      fixture.setReplies([
        ...Array.from({ length: 4 }, () => ({ status: 503, body: {} })),
        businessReply,
        { status: 503, body: {} },
        { status: 200, body: VALID_BODY },
      ]);

      for (let failure = 0; failure < 4; failure += 1) {
        await expect(client.getBaseRate(ROOM_ID, DATE)).rejects.toBeInstanceOf(
          Module1UnavailableError,
        );
      }
      await expect(client.getBaseRate(ROOM_ID, DATE)).rejects.toMatchObject({
        errorCode: label,
      });
      await expect(client.getBaseRate(ROOM_ID, DATE)).rejects.toBeInstanceOf(
        Module1UnavailableError,
      );
      await expect(client.getBaseRate(ROOM_ID, DATE)).resolves.toBeDefined();
      expect(fixture.requests).toBe(7);
    },
  );

  it.each([
    ['malformed response', { status: 200, rawBody: 'not-json' }],
    [
      'amount with more than two significant decimal places',
      { status: 200, body: { ...VALID_BODY, baseRate: '250000.505' } },
    ],
    ['timeout', { status: 200, body: VALID_BODY, delayMs: 600 }],
    ['network failure', { status: 503, dropConnection: true }],
  ] as Array<[string, Module1Reply]>)(
    'counts %s toward the five-failure threshold',
    async (_label, reply) => {
      fixture.setReplies([...Array.from({ length: 4 }, () => ({ status: 503, body: {} })), reply]);

      for (let failure = 0; failure < 5; failure += 1) {
        await expect(client.getBaseRate(ROOM_ID, DATE)).rejects.toMatchObject({
          errorCode: 'MODULE1_UNAVAILABLE',
        });
      }
      await expect(client.getBaseRate(ROOM_ID, DATE)).rejects.toBeInstanceOf(
        Module1UnavailableError,
      );
      expect(fixture.requests).toBe(5);
    },
  );

  it('does not extend the original open window when requests are rejected by the breaker', async () => {
    jest.useFakeTimers();
    fixture.setReplies([
      ...Array.from({ length: 5 }, () => ({ status: 503, body: {} })),
      { status: 200, body: VALID_BODY },
    ]);

    for (let failure = 0; failure < 5; failure += 1) {
      await expect(client.getBaseRate(ROOM_ID, DATE)).rejects.toBeInstanceOf(
        Module1UnavailableError,
      );
    }
    expect(fixture.requests).toBe(5);

    for (let rejection = 0; rejection < 10; rejection += 1) {
      await expect(client.getBaseRate(ROOM_ID, DATE)).rejects.toBeInstanceOf(
        Module1UnavailableError,
      );
    }
    expect(fixture.requests).toBe(5);

    await jest.advanceTimersByTimeAsync(30_000);
    await expect(client.getBaseRate(ROOM_ID, DATE)).resolves.toBeDefined();
    expect(fixture.requests).toBe(6);
  });

  it('reopens for a fresh 30 s after a failed half-open probe, then closes on success', async () => {
    jest.useFakeTimers();
    fixture.setReplies([
      ...Array.from({ length: 5 }, () => ({ status: 503, body: {} })),
      { status: 503, body: {} },
      { status: 200, body: VALID_BODY },
    ]);

    for (let failure = 0; failure < 5; failure += 1) {
      await expect(client.getBaseRate(ROOM_ID, DATE)).rejects.toBeInstanceOf(
        Module1UnavailableError,
      );
    }
    expect(fixture.requests).toBe(5);

    await jest.advanceTimersByTimeAsync(30_000);
    await expect(client.getBaseRate(ROOM_ID, DATE)).rejects.toBeInstanceOf(Module1UnavailableError);
    expect(fixture.requests).toBe(6);

    await jest.advanceTimersByTimeAsync(29_999);
    await expect(client.getBaseRate(ROOM_ID, DATE)).rejects.toBeInstanceOf(Module1UnavailableError);
    expect(fixture.requests).toBe(6);

    await jest.advanceTimersByTimeAsync(1);
    await expect(client.getBaseRate(ROOM_ID, DATE)).resolves.toBeDefined();
    await expect(client.getBaseRate(ROOM_ID, DATE)).resolves.toBeDefined();
    expect(fixture.requests).toBe(8);
  });
  it('closes the circuit when the half-open probe returns ROOM_NOT_FOUND', async () => {
    jest.useFakeTimers();
    fixture.setReplies([
      ...Array.from({ length: 5 }, () => ({ status: 503, body: {} })),
      { status: 404, body: { errorCode: 'ROOM_NOT_FOUND', message: 'missing' } },
      { status: 200, body: VALID_BODY },
    ]);

    for (let failure = 0; failure < 5; failure += 1) {
      await expect(client.getBaseRate(ROOM_ID, DATE)).rejects.toBeInstanceOf(
        Module1UnavailableError,
      );
    }

    await jest.advanceTimersByTimeAsync(30_000);

    await expect(client.getBaseRate(ROOM_ID, DATE)).rejects.toBeInstanceOf(RoomNotFoundError);
    await expect(client.getBaseRate(ROOM_ID, DATE)).resolves.toBeDefined();
    expect(fixture.requests).toBe(7);
  });

  it.each([
    ['missing MODULE1_BASE_URL', undefined, '500', 'Falta configurar MODULE1_BASE_URL.'],
    ['blank MODULE1_BASE_URL', '   ', '500', 'Falta configurar MODULE1_BASE_URL.'],
    [
      'missing MODULE1_TIMEOUT_MS',
      'http://module1.test',
      undefined,
      'Falta configurar MODULE1_TIMEOUT_MS.',
    ],
    [
      'non-numeric MODULE1_TIMEOUT_MS',
      'http://module1.test',
      'abc',
      'MODULE1_TIMEOUT_MS debe ser un entero positivo.',
    ],
    [
      'zero MODULE1_TIMEOUT_MS',
      'http://module1.test',
      '0',
      'MODULE1_TIMEOUT_MS debe ser un entero positivo.',
    ],
    [
      'negative MODULE1_TIMEOUT_MS',
      'http://module1.test',
      '-5',
      'MODULE1_TIMEOUT_MS debe ser un entero positivo.',
    ],
    [
      'decimal MODULE1_TIMEOUT_MS',
      'http://module1.test',
      '1.5',
      'MODULE1_TIMEOUT_MS debe ser un entero positivo.',
    ],
  ])('fails at startup with %s', (_label, baseUrl, timeout, message) => {
    const config = {
      get: (name: string) => (name === 'MODULE1_BASE_URL' ? baseUrl : timeout),
    } as unknown as ConfigService;

    expect(() => new Module1BaseRateClient({} as HttpService, config)).toThrow(message);
  });

  it('maps a dropped connection to a network error, not to a timeout', async () => {
    fixture.setReply({ status: 503, dropConnection: true });

    await expect(client.getBaseRate(ROOM_ID, DATE)).rejects.toMatchObject({
      errorCode: 'MODULE1_UNAVAILABLE',
      cause: { code: 'ECONNRESET' },
    });
  });
});
