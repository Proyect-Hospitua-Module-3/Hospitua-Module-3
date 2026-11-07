// Feature 010 · Registrar Check-out
// Topología, publicador y consumer contra un RabbitMQ real (T005, T006, T007, T018).
// Necesita un broker de pruebas, por ejemplo el del docker-compose.yml:
//   TEST_RABBITMQ_URL=amqp://hospitua:hospitua@localhost:5672 npm test
// Sin TEST_RABBITMQ_URL estas pruebas se omiten. ¡Vacía las colas modulo3.checkout* de ese broker!
import { Channel, ChannelModel, ConfirmChannel, connect, GetMessage } from 'amqplib';
import {
  RegisterCheckoutCommand,
  RegisterCheckoutResult,
  RegisterCheckoutUseCase,
} from '../../../src/domain/ports/in/checkout-ingestion/register-checkout.use-case';
import { CheckoutRegisteredConsumer } from '../../../src/infrastructure/adapters/in/messaging/checkout-registered.consumer';
import { RabbitMqCheckoutMessagePublisher } from '../../../src/infrastructure/adapters/out/messaging/rabbitmq-checkout-message-publisher.adapter';
import {
  assertCheckoutTopology,
  CHECKOUT_DEAD_LETTER_QUEUE,
  CHECKOUT_QUEUE,
  CHECKOUT_RETRY_QUEUE,
  CHECKOUT_ROUTING_KEY,
  HOSPITUA_EVENTS_EXCHANGE,
} from '../../../src/infrastructure/config/rabbitmq.config';
import { toBody, validEnvelope } from '../../support/checkout-ingestion/checkout-event-fixtures';

const TEST_RABBITMQ_URL = process.env.TEST_RABBITMQ_URL;
const describeWithBroker = TEST_RABBITMQ_URL ? describe : describe.skip;

const QUEUES = [CHECKOUT_QUEUE, CHECKOUT_RETRY_QUEUE, CHECKOUT_DEAD_LETTER_QUEUE];

async function waitForMessage(channel: Channel, queue: string): Promise<GetMessage> {
  for (let attempt = 0; attempt < 50; attempt++) {
    const message = await channel.get(queue, { noAck: true });
    if (message) return message;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`No llegó ningún mensaje a ${queue}`);
}

// Caso de uso de prueba: devuelve los resultados indicados, uno por entrega.
class ScriptedUseCase implements RegisterCheckoutUseCase {
  readonly received: RegisterCheckoutCommand[] = [];
  constructor(private readonly results: RegisterCheckoutResult[]) {}

  async register(command: RegisterCheckoutCommand): Promise<RegisterCheckoutResult> {
    this.received.push(command);
    return this.results.shift() ?? 'ACK';
  }
}

describeWithBroker('Mensajería de la feature 010 (RabbitMQ real)', () => {
  let connection: ChannelModel;
  let channel: ConfirmChannel;

  beforeAll(async () => {
    connection = await connect(TEST_RABBITMQ_URL!);
    channel = await connection.createConfirmChannel();
    await assertCheckoutTopology(channel);
  });

  beforeEach(async () => {
    for (const queue of QUEUES) {
      await channel.purgeQueue(queue);
    }
  });

  afterAll(async () => {
    await connection.close();
  });

  describe('topología (T005)', () => {
    it('es idempotente: declararla otra vez no falla', async () => {
      await expect(assertCheckoutTopology(channel)).resolves.toBeUndefined();
    });

    it('un evento publicado en hospitua.events con facturacion.checkout llega a modulo3.checkout', async () => {
      channel.publish(HOSPITUA_EVENTS_EXCHANGE, CHECKOUT_ROUTING_KEY, Buffer.from('{}'));
      await channel.waitForConfirms();
      expect((await waitForMessage(channel, CHECKOUT_QUEUE)).content.toString()).toBe('{}');
    });

    it('un evento habitacion.checkout no llega a modulo3.checkout', async () => {
      channel.publish(HOSPITUA_EVENTS_EXCHANGE, 'habitacion.checkout', Buffer.from('{}'));
      await channel.waitForConfirms();
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(await channel.get(CHECKOUT_QUEUE, { noAck: true })).toBe(false);
    });

    it('las colas de reintento y DLQ no reciben eventos de hospitua.events', async () => {
      channel.publish(HOSPITUA_EVENTS_EXCHANGE, CHECKOUT_ROUTING_KEY, Buffer.from('{}'));
      await channel.waitForConfirms();
      await waitForMessage(channel, CHECKOUT_QUEUE);
      expect(await channel.get(CHECKOUT_RETRY_QUEUE, { noAck: true })).toBe(false);
      expect(await channel.get(CHECKOUT_DEAD_LETTER_QUEUE, { noAck: true })).toBe(false);
    });
  });

  describe('publicador (T006)', () => {
    let publisherChannel: ConfirmChannel;
    let publisher: RabbitMqCheckoutMessagePublisher;

    beforeEach(async () => {
      publisherChannel = await connection.createConfirmChannel();
      publisher = new RabbitMqCheckoutMessagePublisher(publisherChannel, 2_000);
    });

    afterEach(async () => {
      await publisherChannel.close().catch(() => undefined);
    });

    it('publica a retry persistente, con el cuerpo, los headers y x-retry-count', async () => {
      const body = toBody(validEnvelope());
      await publisher.publishToRetry(body, { 'x-correlation-id': 'abc' }, 3);

      const message = await waitForMessage(channel, CHECKOUT_RETRY_QUEUE);
      expect(message.content.equals(Buffer.from(body))).toBe(true);
      expect(message.properties.deliveryMode).toBe(2);
      expect(message.properties.headers).toMatchObject({
        'x-correlation-id': 'abc',
        'x-retry-count': 3,
      });
    });

    it('publica a la DLQ conservando cuerpo y headers', async () => {
      await publisher.publishToDeadLetter(toBody('no-json'), { origen: 'prueba' });

      const message = await waitForMessage(channel, CHECKOUT_DEAD_LETTER_QUEUE);
      expect(message.content.toString()).toBe('no-json');
      expect(message.properties.headers).toMatchObject({ origen: 'prueba' });
    });

    it('rechaza la publicación si el broker la devuelve (basic.return) y sigue funcionando', async () => {
      await channel.deleteQueue(CHECKOUT_DEAD_LETTER_QUEUE);
      try {
        await expect(publisher.publishToDeadLetter(toBody('x'), {})).rejects.toThrow(
          'basic.return',
        );
      } finally {
        await assertCheckoutTopology(channel);
      }
      await expect(publisher.publishToDeadLetter(toBody('y'), {})).resolves.toBeUndefined();
    });

    it('rechaza la publicación si el canal está cerrado', async () => {
      await publisherChannel.close();
      await expect(publisher.publishToRetry(toBody('x'), {}, 1)).rejects.toThrow();
    });
  });

  describe('consumer (T007)', () => {
    let consumerChannel: Channel;

    beforeEach(async () => {
      consumerChannel = await connection.createChannel();
    });

    afterEach(async () => {
      await consumerChannel.close().catch(() => undefined);
    });

    it('entrega cuerpo y headers sin interpretar, y hace ack', async () => {
      const useCase = new ScriptedUseCase(['ACK']);
      await new CheckoutRegisteredConsumer(useCase).start(consumerChannel);

      channel.publish(HOSPITUA_EVENTS_EXCHANGE, CHECKOUT_ROUTING_KEY, Buffer.from('{"a":1}'), {
        headers: { 'x-retry-count': 2 },
      });
      await channel.waitForConfirms();
      await waitFor(() => useCase.received.length === 1);

      expect(Buffer.from(useCase.received[0].body).toString()).toBe('{"a":1}');
      expect(useCase.received[0].headers).toMatchObject({ 'x-retry-count': 2 });
      await consumerChannel.close();
      expect(await channel.checkQueue(CHECKOUT_QUEUE)).toMatchObject({ messageCount: 0 });
    });

    it('con NACK_REQUEUE reencola el mensaje y lo vuelve a entregar', async () => {
      const useCase = new ScriptedUseCase(['NACK_REQUEUE', 'ACK']);
      await new CheckoutRegisteredConsumer(useCase).start(consumerChannel);

      channel.publish(HOSPITUA_EVENTS_EXCHANGE, CHECKOUT_ROUTING_KEY, Buffer.from('{}'));
      await channel.waitForConfirms();
      await waitFor(() => useCase.received.length === 2);

      await consumerChannel.close();
      expect(await channel.checkQueue(CHECKOUT_QUEUE)).toMatchObject({ messageCount: 0 });
    });
  });
});

async function waitFor(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt++) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('La condición no se cumplió a tiempo');
}
