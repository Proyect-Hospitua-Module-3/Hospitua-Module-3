// Feature 007 · Generar liquidación (T015)
// Cliente real de Módulo 2 contra un servidor HTTP simulado: 200, 404, timeout de 500 ms,
// 5xx, fallo de red y circuito abierto (5 fallos seguidos, vuelve a probar a los 30 s).
import { ConfigService } from '@nestjs/config';
import { HttpModule, HttpService } from '@nestjs/axios';
import { Test, TestingModule } from '@nestjs/testing';
import { Module2UnavailableError } from '../../../src/domain/errors/settlement/module2-unavailable.error';
import { ReservationNotFoundError } from '../../../src/domain/errors/settlement/reservation-not-found.error';
import { Module2ReservationClient } from '../../../src/infrastructure/adapters/out/http/module2-reservation.client';
import { Module1HttpFixture, Module1Reply } from '../../support/pricing/module1-http-fixture';

const REF = 'RES-000123';
const QUOTE_A = 'a1f2c3d4-e5b6-4789-8a9b-0c1d2e3f4a5b';
const CORRELATION_ID = '9b1f6d3e-2c4a-4f7b-8e5d-3a1c0b9d8e72';
const DIRECT = { reservationRef: REF, quoteIds: [QUOTE_A] };
const NOT_FOUND: Module1Reply = { status: 404, body: { errorCode: 'RESERVATION_NOT_FOUND' } };

describe('Module2ReservationClient HTTP integration', () => {
  let fixture: Module1HttpFixture;
  let moduleRef: TestingModule;
  let client: Module2ReservationClient;

  beforeEach(async () => {
    fixture = new Module1HttpFixture();
    await fixture.start();
    fixture.setReply({ status: 200, body: DIRECT });
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
    client = moduleRef.get(Module2ReservationClient);
  });

  afterEach(async () => {
    jest.useRealTimers();
    await moduleRef?.close();
    await fixture.stop();
  });

  it('hace GET /api/reservations/{ref} sin token, con Accept y X-Correlation-Id', async () => {
    await client.getReservation(REF, CORRELATION_ID);

    expect(fixture.requestLog).toHaveLength(1);
    const [request] = fixture.requestLog;
    expect(request.method).toBe('GET');
    expect(request.url).toBe(`/api/reservations/${REF}`);
    expect(request.headers.accept).toBe('application/json');
    expect(request.headers['x-correlation-id']).toBe(CORRELATION_ID);
    expect(request.headers.authorization).toBeUndefined();
  });

  it('codifica el reservationRef en la URL', async () => {
    const ref = 'RES 1/2';
    fixture.setReply({ status: 200, body: { ...DIRECT, reservationRef: ref } });

    await client.getReservation(ref);

    expect(fixture.requestLog[0].url).toBe('/api/reservations/RES%201%2F2');
  });

  it('consulta Módulo 2 en cada llamada, sin caché', async () => {
    await client.getReservation(REF);
    await client.getReservation(REF);

    expect(fixture.requests).toBe(2);
  });

  it('404 → RESERVATION_NOT_FOUND, con o sin cuerpo, sin contar para el circuito', async () => {
    fixture.setReplies([NOT_FOUND, { status: 404 }, { status: 200, body: DIRECT }]);

    await expect(client.getReservation(REF)).rejects.toBeInstanceOf(ReservationNotFoundError);
    await expect(client.getReservation(REF)).rejects.toBeInstanceOf(ReservationNotFoundError);
    await expect(client.getReservation(REF)).resolves.toMatchObject({ reservationRef: REF });
  });

  it.each([
    ['5xx', { status: 503, body: {} }],
    ['400 (problema de contrato)', { status: 400, body: {} }],
    ['401 (problema de configuración)', { status: 401, body: {} }],
    ['403', { status: 403, body: {} }],
    ['cuerpo que no es JSON', { status: 200, rawBody: '<html>error</html>' }],
    ['fallo de red', { status: 503, dropConnection: true }],
  ] as Array<[string, Module1Reply]>)('%s → MODULE2_UNAVAILABLE', async (_label, reply) => {
    fixture.setReply(reply);

    await expect(client.getReservation(REF)).rejects.toMatchObject({
      errorCode: 'MODULE2_UNAVAILABLE',
      reservationRef: REF,
    });
  });

  it('una respuesta de más de 500 ms → MODULE2_UNAVAILABLE', async () => {
    fixture.setReply({ status: 200, body: DIRECT, delayMs: 600 });

    await expect(client.getReservation(REF)).rejects.toBeInstanceOf(Module2UnavailableError);
  });

  it('abre el circuito en el quinto fallo seguido y deja de llamar a Módulo 2', async () => {
    fixture.setReply({ status: 503, body: {} });

    for (let failure = 0; failure < 5; failure += 1) {
      await expect(client.getReservation(REF)).rejects.toBeInstanceOf(Module2UnavailableError);
    }
    await expect(client.getReservation(REF)).rejects.toBeInstanceOf(Module2UnavailableError);

    expect(fixture.requests).toBe(5);
  });

  it('no abre tras 4 fallos, un éxito y otro fallo', async () => {
    fixture.setReplies([
      ...Array.from({ length: 4 }, () => ({ status: 503, body: {} })),
      { status: 200, body: DIRECT },
      { status: 503, body: {} },
      { status: 200, body: DIRECT },
    ]);

    for (let failure = 0; failure < 4; failure += 1) {
      await expect(client.getReservation(REF)).rejects.toBeInstanceOf(Module2UnavailableError);
    }
    await expect(client.getReservation(REF)).resolves.toBeDefined();
    await expect(client.getReservation(REF)).rejects.toBeInstanceOf(Module2UnavailableError);
    await expect(client.getReservation(REF)).resolves.toBeDefined();
    expect(fixture.requests).toBe(7);
  });

  it('un 404 entre fallos no cuenta como fallo seguido', async () => {
    fixture.setReplies([
      ...Array.from({ length: 4 }, () => ({ status: 503, body: {} })),
      NOT_FOUND,
      { status: 503, body: {} },
      { status: 200, body: DIRECT },
    ]);

    for (let failure = 0; failure < 4; failure += 1) {
      await expect(client.getReservation(REF)).rejects.toBeInstanceOf(Module2UnavailableError);
    }
    await expect(client.getReservation(REF)).rejects.toBeInstanceOf(ReservationNotFoundError);
    await expect(client.getReservation(REF)).rejects.toBeInstanceOf(Module2UnavailableError);
    await expect(client.getReservation(REF)).resolves.toBeDefined();
    expect(fixture.requests).toBe(7);
  });

  it('una respuesta fuera de contrato cuenta para el circuito', async () => {
    fixture.setReplies([
      ...Array.from({ length: 4 }, () => ({ status: 503, body: {} })),
      { status: 200, body: { reservationRef: REF } },
    ]);

    for (let failure = 0; failure < 5; failure += 1) {
      await expect(client.getReservation(REF)).rejects.toBeInstanceOf(Module2UnavailableError);
    }
    await expect(client.getReservation(REF)).rejects.toBeInstanceOf(Module2UnavailableError);
    expect(fixture.requests).toBe(5);
  });

  it('vuelve a probar a los 30 s y, si responde, cierra el circuito', async () => {
    jest.useFakeTimers();
    fixture.setReplies([
      ...Array.from({ length: 5 }, () => ({ status: 503, body: {} })),
      { status: 200, body: DIRECT },
    ]);

    for (let failure = 0; failure < 5; failure += 1) {
      await expect(client.getReservation(REF)).rejects.toBeInstanceOf(Module2UnavailableError);
    }
    await jest.advanceTimersByTimeAsync(29_999);
    await expect(client.getReservation(REF)).rejects.toBeInstanceOf(Module2UnavailableError);
    expect(fixture.requests).toBe(5);

    await jest.advanceTimersByTimeAsync(1);
    await expect(client.getReservation(REF)).resolves.toBeDefined();
    await expect(client.getReservation(REF)).resolves.toBeDefined();
    expect(fixture.requests).toBe(7);
  });

  it('en half-open, un 404 de negocio también cierra el circuito', async () => {
    jest.useFakeTimers();
    fixture.setReplies([
      ...Array.from({ length: 5 }, () => ({ status: 503, body: {} })),
      NOT_FOUND,
      { status: 200, body: DIRECT },
    ]);

    for (let failure = 0; failure < 5; failure += 1) {
      await expect(client.getReservation(REF)).rejects.toBeInstanceOf(Module2UnavailableError);
    }
    await jest.advanceTimersByTimeAsync(30_000);

    await expect(client.getReservation(REF)).rejects.toBeInstanceOf(ReservationNotFoundError);
    await expect(client.getReservation(REF)).resolves.toBeDefined();
    expect(fixture.requests).toBe(7);
  });

  it.each([
    ['falta MODULE2_BASE_URL', undefined, '500', 'Falta configurar MODULE2_BASE_URL.'],
    ['MODULE2_BASE_URL en blanco', '  ', '500', 'Falta configurar MODULE2_BASE_URL.'],
    [
      'falta MODULE2_TIMEOUT_MS',
      'http://module2.test',
      undefined,
      'Falta configurar MODULE2_TIMEOUT_MS.',
    ],
    [
      'MODULE2_TIMEOUT_MS no numérico',
      'http://module2.test',
      'abc',
      'MODULE2_TIMEOUT_MS debe ser un entero positivo.',
    ],
    [
      'MODULE2_TIMEOUT_MS en cero',
      'http://module2.test',
      '0',
      'MODULE2_TIMEOUT_MS debe ser un entero positivo.',
    ],
    [
      'MODULE2_TIMEOUT_MS decimal',
      'http://module2.test',
      '1.5',
      'MODULE2_TIMEOUT_MS debe ser un entero positivo.',
    ],
  ])('falla al arrancar con %s', (_label, baseUrl, timeout, message) => {
    const config = {
      get: (name: string) => (name === 'MODULE2_BASE_URL' ? baseUrl : timeout),
    } as unknown as ConfigService;

    expect(() => new Module2ReservationClient({} as HttpService, config)).toThrow(message);
  });
});
