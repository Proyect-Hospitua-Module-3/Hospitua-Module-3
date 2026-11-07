// Feature 010 · Registrar Check-out
import {
  CheckoutLogEntry,
  RegisterCheckoutService,
  retryCountOf,
} from '../../../../src/application/services/checkout-ingestion/register-checkout.service';
import { DomainError } from '../../../../src/domain/errors/domain.error';
import { CheckoutEvent } from '../../../../src/domain/model/checkout-ingestion/checkout-event';
import {
  CheckoutEventProcessorPort,
  CheckoutProcessingResult,
} from '../../../../src/domain/ports/out/checkout-ingestion/checkout-event-processor.port';
import { toBody, validEnvelope } from '../../../support/checkout-ingestion/checkout-event-fixtures';
import { FakeCheckoutMessagePublisher } from '../../../support/checkout-ingestion/fake-checkout-message-publisher';
import { InMemoryCheckoutEventLogRepository } from '../../../support/checkout-ingestion/in-memory-checkout-event-log.repository';

const EVENT_ID = 'a5d8b76e-3f91-4c22-b88a-9e67d4f91012';

class TestError extends DomainError {
  constructor(readonly errorCode: string) {
    super(`Falla simulada ${errorCode}`);
  }
}

// Doble del paso de negocio (007 + 006), que todavía no existe.
class FakeProcessor implements CheckoutEventProcessorPort {
  readonly received: CheckoutEvent[] = [];
  outcome: CheckoutProcessingResult | Error = { resultNote: null };

  constructor(private readonly calls: string[]) {}

  async process(event: CheckoutEvent): Promise<CheckoutProcessingResult> {
    this.calls.push('process');
    this.received.push(event);
    if (this.outcome instanceof Error) throw this.outcome;
    return this.outcome;
  }
}

describe('RegisterCheckoutService', () => {
  let calls: string[];
  let eventLogs: InMemoryCheckoutEventLogRepository;
  let publisher: FakeCheckoutMessagePublisher;
  let processor: FakeProcessor;
  let logEntries: CheckoutLogEntry[];
  let service: RegisterCheckoutService;

  beforeEach(() => {
    calls = [];
    eventLogs = new InMemoryCheckoutEventLogRepository(calls);
    publisher = new FakeCheckoutMessagePublisher(calls);
    processor = new FakeProcessor(calls);
    logEntries = [];
    service = new RegisterCheckoutService(eventLogs, publisher, processor, (entry) =>
      logEntries.push(entry),
    );
  });

  const register = (body: Uint8Array = toBody(validEnvelope()), headers = {}) =>
    service.register({ body, headers });

  describe('evento válido', () => {
    it('lo procesa, lo deja PROCESSED y hace ack', async () => {
      await expect(register()).resolves.toBe('ACK');

      expect(processor.received).toHaveLength(1);
      expect(processor.received[0].stayId).toBe('d1e4c7b8-2a55-4e31-89d2-b0a112233445');
      expect(eventLogs.byEventId(EVENT_ID)).toMatchObject({
        status: 'PROCESSED',
        resultNote: null,
      });
      expect(publisher.published).toEqual([]);
    });

    it('guarda la nota de un resultado sin factura', async () => {
      processor.outcome = {
        resultNote: 'Factura no emitida: datos tributarios ausentes o incompletos',
      };
      await expect(register()).resolves.toBe('ACK');
      expect(eventLogs.byEventId(EVENT_ID)?.resultNote).toBe(
        'Factura no emitida: datos tributarios ausentes o incompletos',
      );
    });

    it('registra en PENDING antes de procesar y no guarda datos tributarios en la auditoría', async () => {
      await register();
      expect(calls.slice(0, 2)).toEqual(['registerIfAbsent', 'process']);
      const payload = JSON.stringify(eventLogs.byEventId(EVENT_ID)?.payload);
      expect(payload).not.toContain('Comercializadora');
      expect(payload).not.toContain('900123456-7');
      expect(eventLogs.byEventId(EVENT_ID)?.payload?.has_billing_customer).toBe(true);
    });

    it('deja un log estructurado sin datos tributarios', async () => {
      await register();
      expect(logEntries).toEqual([
        expect.objectContaining({
          eventId: EVENT_ID,
          stayId: 'd1e4c7b8-2a55-4e31-89d2-b0a112233445',
          outcome: 'PROCESSED',
          errorCode: null,
        }),
      ]);
    });
  });

  describe('deduplicación por eventId (HU3, escenario 2)', () => {
    it.each(['PROCESSED', 'REJECTED', 'DEAD_LETTER'])(
      'hace ack sin reprocesar un evento ya %s',
      async (status) => {
        if (status === 'PROCESSED') {
          await register();
        } else if (status === 'REJECTED') {
          await register(toBody({ ...validEnvelope(), eventType: 'OTRO' }));
        } else {
          processor.outcome = new TestError('QUOTE_NOT_FOUND');
          await register();
        }
        const publishedBefore = publisher.published.length;
        processor.received.length = 0;

        await expect(register()).resolves.toBe('ACK');

        expect(processor.received).toEqual([]);
        expect(publisher.published).toHaveLength(publishedBefore);
        expect(logEntries.at(-1)?.outcome).toBe('DUPLICATE');
      },
    );

    it('reanuda un evento que quedó en PENDING', async () => {
      publisher.failing = true;
      processor.outcome = new TestError('QUOTE_NOT_FOUND');
      await expect(register()).resolves.toBe('NACK_REQUEUE');
      expect(eventLogs.byEventId(EVENT_ID)?.status).toBe('PENDING');

      publisher.failing = false;
      processor.outcome = { resultNote: null };
      await expect(register()).resolves.toBe('ACK');
      expect(eventLogs.byEventId(EVENT_ID)?.status).toBe('PROCESSED');
    });
  });

  describe('sobre no reconocible', () => {
    it.each([
      ['JSON inválido', toBody('{"eventId": '), 'no es JSON válido'],
      ['UTF-8 inválido', new Uint8Array([0xff, 0xfe, 0x7b]), 'no es JSON válido'],
      ['sin eventId', toBody({ eventType: 'CHECK_OUT' }), 'eventId'],
      ['eventId que no es UUID', toBody({ ...validEnvelope(), eventId: 'ev-1' }), 'eventId'],
    ])(
      'con %s: publica a la DLQ, registra REJECTED sin event_id y hace ack',
      async (_c, body, reason) => {
        await expect(register(body)).resolves.toBe('ACK');

        expect(calls).toEqual(['publishToDeadLetter', 'registerUnrecognizedEnvelopeRejection']);
        expect(publisher.published[0]).toMatchObject({ queue: 'dlq', body });
        expect(eventLogs.logs).toEqual([
          expect.objectContaining({
            eventId: null,
            payload: null,
            status: 'REJECTED',
            errorCode: 'INVALID_CHECKOUT_EVENT',
          }),
        ]);
        expect(eventLogs.logs[0].reason).toContain(reason);
        expect(processor.received).toEqual([]);
      },
    );

    it('hace nack y no registra nada si la publicación a la DLQ falla', async () => {
      publisher.failing = true;
      await expect(register(toBody('no-json'))).resolves.toBe('NACK_REQUEUE');
      expect(eventLogs.logs).toEqual([]);
    });

    it('hace nack si falla el registro después de confirmar la DLQ', async () => {
      eventLogs.failing.add('registerUnrecognizedEnvelopeRejection');
      await expect(register(toBody('no-json'))).resolves.toBe('NACK_REQUEUE');
      expect(publisher.published).toHaveLength(1);
    });
  });

  describe('evento reconocible inválido (HU2)', () => {
    const invalid = () => toBody({ ...validEnvelope(), occurredAt: '2026-10-08T11:00:00' });

    it('publica a la DLQ, después lo deja REJECTED y hace ack, sin procesarlo', async () => {
      await expect(register(invalid())).resolves.toBe('ACK');

      expect(calls).toEqual(['registerIfAbsent', 'publishToDeadLetter', 'markRejected']);
      expect(eventLogs.byEventId(EVENT_ID)).toMatchObject({
        status: 'REJECTED',
        errorCode: 'INVALID_CHECKOUT_EVENT',
      });
      expect(eventLogs.byEventId(EVENT_ID)?.reason).toContain('occurredAt');
      expect(processor.received).toEqual([]);
    });

    it('conserva el registro en PENDING y hace nack si la DLQ no confirma', async () => {
      publisher.failing = true;
      await expect(register(invalid())).resolves.toBe('NACK_REQUEUE');
      expect(eventLogs.byEventId(EVENT_ID)?.status).toBe('PENDING');
    });

    it('hace nack si falla markRejected después de confirmar la DLQ', async () => {
      eventLogs.failing.add('markRejected');
      await expect(register(invalid())).resolves.toBe('NACK_REQUEUE');
      expect(publisher.published).toHaveLength(1);
      expect(eventLogs.byEventId(EVENT_ID)?.status).toBe('PENDING');
    });
  });

  describe('errores no recuperables', () => {
    it.each([
      'RESERVATION_NOT_FOUND',
      'QUOTE_NOT_FOUND',
      'MISSING_COMMISSION',
      'INVALID_COMMISSION',
      'SETTLEMENT_ALREADY_EXISTS',
      'VAT_RATE_NOT_CONFIGURED',
      'FINAL_SETTLEMENT_NOT_FOUND',
    ])('%s: publica a la DLQ, después DEAD_LETTER con su código, y hace ack', async (code) => {
      processor.outcome = new TestError(code);

      await expect(register()).resolves.toBe('ACK');

      expect(calls).toEqual([
        'registerIfAbsent',
        'process',
        'publishToDeadLetter',
        'markDeadLetter',
      ]);
      expect(eventLogs.byEventId(EVENT_ID)).toMatchObject({
        status: 'DEAD_LETTER',
        errorCode: code,
        reason: `Falla simulada ${code}`,
      });
    });

    it('registra UNEXPECTED_ERROR para un error no tipado', async () => {
      processor.outcome = new TypeError('fallo raro');
      await expect(register()).resolves.toBe('ACK');
      expect(eventLogs.byEventId(EVENT_ID)).toMatchObject({
        status: 'DEAD_LETTER',
        errorCode: 'UNEXPECTED_ERROR',
        reason: 'fallo raro',
      });
    });

    it('conserva PENDING y hace nack si la DLQ no confirma', async () => {
      processor.outcome = new TestError('QUOTE_NOT_FOUND');
      publisher.failing = true;
      await expect(register()).resolves.toBe('NACK_REQUEUE');
      expect(eventLogs.byEventId(EVENT_ID)?.status).toBe('PENDING');
    });
  });

  describe('fallas transitorias (NFR-005)', () => {
    it.each(['MODULE2_UNAVAILABLE', 'VAT_RATE_UNAVAILABLE', 'DATABASE_UNAVAILABLE'])(
      '%s: publica a retry con x-retry-count incrementado, deja PENDING y hace ack',
      async (code) => {
        processor.outcome = new TestError(code);

        await expect(register(toBody(validEnvelope()), { 'x-retry-count': 2 })).resolves.toBe(
          'ACK',
        );

        expect(publisher.published).toEqual([
          expect.objectContaining({ queue: 'retry', retryCount: 3 }),
        ]);
        expect(eventLogs.byEventId(EVENT_ID)?.status).toBe('PENDING');
        expect(logEntries[0]).toMatchObject({ outcome: 'RETRY', errorCode: code });
      },
    );

    it('el primer reintento lleva x-retry-count 1 y conserva cuerpo y headers', async () => {
      processor.outcome = new TestError('MODULE2_UNAVAILABLE');
      const body = toBody(validEnvelope());
      await register(body, { 'x-correlation-id': 'abc' });
      expect(publisher.published[0]).toEqual({
        queue: 'retry',
        body,
        headers: { 'x-correlation-id': 'abc' },
        retryCount: 1,
      });
    });

    it('con x-retry-count 5 publica a la DLQ y registra DEAD_LETTER con el código del fallo actual', async () => {
      processor.outcome = new TestError('VAT_RATE_UNAVAILABLE');

      await expect(register(toBody(validEnvelope()), { 'x-retry-count': 5 })).resolves.toBe('ACK');

      expect(calls).toEqual([
        'registerIfAbsent',
        'process',
        'publishToDeadLetter',
        'markDeadLetter',
      ]);
      expect(eventLogs.byEventId(EVENT_ID)).toMatchObject({
        status: 'DEAD_LETTER',
        errorCode: 'VAT_RATE_UNAVAILABLE',
      });
    });

    it('recorre los 5 reintentos y el siguiente fallo va a la DLQ (T019)', async () => {
      processor.outcome = new TestError('MODULE2_UNAVAILABLE');
      let headers: Record<string, unknown> = {};
      for (let attempt = 1; attempt <= 5; attempt++) {
        await expect(register(toBody(validEnvelope()), headers)).resolves.toBe('ACK');
        const retried = publisher.published.at(-1)!;
        expect(retried).toMatchObject({ queue: 'retry', retryCount: attempt });
        headers = { ...retried.headers, 'x-retry-count': retried.retryCount };
      }

      await expect(register(toBody(validEnvelope()), headers)).resolves.toBe('ACK');

      expect(publisher.published.at(-1)?.queue).toBe('dlq');
      expect(processor.received).toHaveLength(6);
      expect(eventLogs.byEventId(EVENT_ID)?.status).toBe('DEAD_LETTER');
    });

    it('hace nack y conserva PENDING si retry no confirma', async () => {
      processor.outcome = new TestError('MODULE2_UNAVAILABLE');
      publisher.failing = true;
      await expect(register()).resolves.toBe('NACK_REQUEUE');
      expect(eventLogs.byEventId(EVENT_ID)?.status).toBe('PENDING');
    });

    it('hace nack si falla markDeadLetter tras agotar los reintentos', async () => {
      processor.outcome = new TestError('MODULE2_UNAVAILABLE');
      eventLogs.failing.add('markDeadLetter');
      await expect(register(toBody(validEnvelope()), { 'x-retry-count': 5 })).resolves.toBe(
        'NACK_REQUEUE',
      );
      expect(publisher.published.at(-1)?.queue).toBe('dlq');
    });
  });

  describe('fallas de la auditoría (DATABASE_UNAVAILABLE)', () => {
    it('si registerIfAbsent falla, va a retry sin procesar y sin registro', async () => {
      eventLogs.failing.add('registerIfAbsent');

      await expect(register()).resolves.toBe('ACK');

      expect(publisher.published).toEqual([
        expect.objectContaining({ queue: 'retry', retryCount: 1 }),
      ]);
      expect(processor.received).toEqual([]);
      expect(logEntries[0]).toMatchObject({ errorCode: 'DATABASE_UNAVAILABLE', outcome: 'RETRY' });
    });

    it('el registro se crea cuando una reentrega logra escribirlo', async () => {
      eventLogs.failing.add('registerIfAbsent');
      await register();
      eventLogs.failing.clear();

      await expect(register(toBody(validEnvelope()), { 'x-retry-count': 1 })).resolves.toBe('ACK');

      expect(eventLogs.byEventId(EVENT_ID)?.status).toBe('PROCESSED');
    });

    it('con los reintentos agotados publica a la DLQ e intenta registrar DEAD_LETTER', async () => {
      eventLogs.failing.add('registerIfAbsent');
      await expect(register(toBody(validEnvelope()), { 'x-retry-count': 5 })).resolves.toBe(
        'NACK_REQUEUE',
      );
      // La base sigue caída: la DLQ ya tiene el mensaje, pero el estado no se pudo
      // escribir, así que se hace nack y la reentrega repite la publicación.
      expect(publisher.published).toEqual([expect.objectContaining({ queue: 'dlq' })]);

      eventLogs.failing.clear();
      await expect(register(toBody(validEnvelope()), { 'x-retry-count': 5 })).resolves.toBe('ACK');
      expect(eventLogs.byEventId(EVENT_ID)?.status).toBe('PROCESSED');
    });

    it('si markProcessed falla, va a retry (007 y 006 son idempotentes por stayId)', async () => {
      eventLogs.failing.add('markProcessed');

      await expect(register()).resolves.toBe('ACK');

      expect(publisher.published).toEqual([
        expect.objectContaining({ queue: 'retry', retryCount: 1 }),
      ]);
      expect(eventLogs.byEventId(EVENT_ID)?.status).toBe('PENDING');
    });
  });

  describe('x-retry-count (T018)', () => {
    it.each([
      ['ausente', undefined, 0],
      ['no entero', 2.5, 0],
      ['negativo', -1, 0],
      ['texto', '3', 0],
      ['entero válido', 4, 4],
    ])('lo interpreta como entero no negativo: %s', (_caso, value, expected) => {
      expect(retryCountOf(value === undefined ? {} : { 'x-retry-count': value })).toBe(expected);
    });

    it('x-death no determina el límite de reintentos', async () => {
      processor.outcome = new TestError('MODULE2_UNAVAILABLE');
      const xDeath = [{ count: 9, queue: 'modulo3.checkout.retry.30s', reason: 'expired' }];

      await register(toBody(validEnvelope()), { 'x-death': xDeath, 'x-retry-count': 1 });

      expect(publisher.published[0]).toMatchObject({ queue: 'retry', retryCount: 2 });
    });
  });
});
