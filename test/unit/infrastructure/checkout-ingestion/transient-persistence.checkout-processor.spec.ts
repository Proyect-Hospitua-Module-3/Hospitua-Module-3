// Feature 010 · Registrar Check-out (contrato EVENT-facturacion-checkout, DATABASE_UNAVAILABLE)
import { Prisma } from '@prisma/client';
import {
  CheckoutLogEntry,
  RegisterCheckoutService,
} from '../../../../src/application/services/checkout-ingestion/register-checkout.service';
import { DomainError } from '../../../../src/domain/errors/domain.error';
import { CheckoutPersistenceUnavailableError } from '../../../../src/domain/errors/checkout-ingestion/checkout-persistence-unavailable.error';
import { CheckoutEvent } from '../../../../src/domain/model/checkout-ingestion/checkout-event';
import {
  CheckoutEventProcessorPort,
  CheckoutProcessingResult,
} from '../../../../src/domain/ports/out/checkout-ingestion/checkout-event-processor.port';
import { TransientPersistenceCheckoutProcessor } from '../../../../src/infrastructure/adapters/out/persistence/checkout-ingestion/transient-persistence.checkout-processor';
import { toBody, validEnvelope } from '../../../support/checkout-ingestion/checkout-event-fixtures';
import { FakeCheckoutMessagePublisher } from '../../../support/checkout-ingestion/fake-checkout-message-publisher';
import { InMemoryCheckoutEventLogRepository } from '../../../support/checkout-ingestion/in-memory-checkout-event-log.repository';

const EVENT_ID = 'a5d8b76e-3f91-4c22-b88a-9e67d4f91012';
const CLIENT_VERSION = '5.22.0';

const knownError = (code: string) =>
  new Prisma.PrismaClientKnownRequestError(`Falla simulada ${code}`, {
    code,
    clientVersion: CLIENT_VERSION,
  });

class TestError extends DomainError {
  readonly errorCode = 'MODULE2_UNAVAILABLE';

  constructor(message: string) {
    super(message);
  }
}

// Doble del paso de negocio: simula lo que lanzan 007 o la lectura de cotizaciones de 005.
class ThrowingProcessor implements CheckoutEventProcessorPort {
  constructor(private readonly error: unknown) {}

  async process(_event: CheckoutEvent): Promise<CheckoutProcessingResult> {
    throw this.error;
  }
}

describe('TransientPersistenceCheckoutProcessor', () => {
  const event = {} as CheckoutEvent;

  it('devuelve el resultado del procesador cuando no hay errores', async () => {
    const inner: CheckoutEventProcessorPort = {
      process: async () => ({ resultNote: 'nota' }),
    };
    await expect(new TransientPersistenceCheckoutProcessor(inner).process(event)).resolves.toEqual({
      resultNote: 'nota',
    });
  });

  it.each([
    ['P1001 (no se alcanza el servidor)', knownError('P1001')],
    ['P1017 (el servidor cerró la conexión)', knownError('P1017')],
    ['P2024 (timeout del pool)', knownError('P2024')],
    [
      'PrismaClientInitializationError',
      new Prisma.PrismaClientInitializationError('Base caída', CLIENT_VERSION),
    ],
  ])('traduce %s a DATABASE_UNAVAILABLE', async (_name, error) => {
    const processor = new TransientPersistenceCheckoutProcessor(new ThrowingProcessor(error));

    const failure = await processor.process(event).catch((caught: unknown) => caught);

    expect(failure).toBeInstanceOf(CheckoutPersistenceUnavailableError);
    expect(failure).toMatchObject({ errorCode: 'DATABASE_UNAVAILABLE', cause: error });
  });

  it('deja pasar un error de Prisma que no es transitorio (reintentar no lo arregla)', async () => {
    const error = knownError('P2003'); // violación de FK
    const processor = new TransientPersistenceCheckoutProcessor(new ThrowingProcessor(error));
    await expect(processor.process(event)).rejects.toBe(error);
  });

  it('deja pasar los errores de dominio tal cual', async () => {
    const error = new TestError('Módulo 2 no responde');
    const processor = new TransientPersistenceCheckoutProcessor(new ThrowingProcessor(error));
    await expect(processor.process(event)).rejects.toBe(error);
  });

  describe('con RegisterCheckoutService', () => {
    let eventLogs: InMemoryCheckoutEventLogRepository;
    let publisher: FakeCheckoutMessagePublisher;
    let logEntries: CheckoutLogEntry[];

    function serviceFailingWith(error: unknown): RegisterCheckoutService {
      const calls: string[] = [];
      eventLogs = new InMemoryCheckoutEventLogRepository(calls);
      publisher = new FakeCheckoutMessagePublisher(calls);
      logEntries = [];
      return new RegisterCheckoutService(
        eventLogs,
        publisher,
        new TransientPersistenceCheckoutProcessor(new ThrowingProcessor(error)),
        (entry) => logEntries.push(entry),
      );
    }

    it('la base caída durante 007 va a retry con DATABASE_UNAVAILABLE, no a la DLQ', async () => {
      const service = serviceFailingWith(knownError('P1001'));

      await expect(service.register({ body: toBody(validEnvelope()), headers: {} })).resolves.toBe(
        'ACK',
      );

      expect(publisher.published).toEqual([
        expect.objectContaining({ queue: 'retry', retryCount: 1 }),
      ]);
      expect(eventLogs.byEventId(EVENT_ID)?.status).toBe('PENDING');
      expect(logEntries[0]).toMatchObject({ outcome: 'RETRY', errorCode: 'DATABASE_UNAVAILABLE' });
    });

    it('agotados los 5 reintentos, va a la DLQ con DATABASE_UNAVAILABLE', async () => {
      const service = serviceFailingWith(knownError('P1001'));

      await expect(
        service.register({ body: toBody(validEnvelope()), headers: { 'x-retry-count': 5 } }),
      ).resolves.toBe('ACK');

      expect(publisher.published).toEqual([expect.objectContaining({ queue: 'dlq' })]);
      expect(eventLogs.byEventId(EVENT_ID)).toMatchObject({
        status: 'DEAD_LETTER',
        errorCode: 'DATABASE_UNAVAILABLE',
      });
    });

    it('un error de Prisma no transitorio sigue yendo a la DLQ como UNEXPECTED_ERROR', async () => {
      const service = serviceFailingWith(knownError('P2003'));

      await service.register({ body: toBody(validEnvelope()), headers: {} });

      expect(publisher.published).toEqual([expect.objectContaining({ queue: 'dlq' })]);
      expect(eventLogs.byEventId(EVENT_ID)).toMatchObject({
        status: 'DEAD_LETTER',
        errorCode: 'UNEXPECTED_ERROR',
      });
    });
  });
});
