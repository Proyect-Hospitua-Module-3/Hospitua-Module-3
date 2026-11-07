// Feature 010 · Registrar Check-out (T001, T011)
// Arranque del consumer con un broker simulado: sin RabbitMQ real.
import { EventEmitter } from 'node:events';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ChannelModel } from 'amqplib';
import { RegisterCheckoutUseCase } from '../../../../src/domain/ports/in/checkout-ingestion/register-checkout.use-case';
import { CheckoutMessagePublisherPort } from '../../../../src/domain/ports/out/checkout-ingestion/checkout-message-publisher.port';
import { RabbitMqCheckoutRunner } from '../../../../src/infrastructure/config/rabbitmq-checkout.runner';
import {
  CHECKOUT_DEAD_LETTER_QUEUE,
  CHECKOUT_QUEUE,
  CHECKOUT_RETRY_QUEUE,
} from '../../../../src/infrastructure/config/rabbitmq.config';

class FakeChannel extends EventEmitter {
  readonly queues: string[] = [];
  readonly consumed: string[] = [];
  prefetchCount?: number;
  closed = false;
  async assertExchange(): Promise<void> {}
  async assertQueue(queue: string): Promise<void> {
    this.queues.push(queue);
  }
  async bindQueue(): Promise<void> {}
  async prefetch(count: number): Promise<void> {
    this.prefetchCount = count;
  }
  async consume(queue: string): Promise<{ consumerTag: string }> {
    this.consumed.push(queue);
    return { consumerTag: 'tag-1' };
  }
  async close(): Promise<void> {
    this.closed = true;
  }
}

class FakeConnection extends EventEmitter {
  readonly channels: FakeChannel[] = [];
  confirmChannels = 0;
  closed = false;
  async createChannel(): Promise<FakeChannel> {
    const channel = new FakeChannel();
    this.channels.push(channel);
    return channel;
  }
  async createConfirmChannel(): Promise<FakeChannel> {
    this.confirmChannels += 1;
    return this.createChannel();
  }
  async close(): Promise<void> {
    this.closed = true;
    this.emit('close');
  }
}

function configWith(url: string | undefined): ConfigService {
  return { get: () => url } as unknown as ConfigService;
}

const useCase: RegisterCheckoutUseCase = { register: async () => 'ACK' };

describe('RabbitMqCheckoutRunner', () => {
  let warn: jest.SpyInstance;
  let error: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it.each([undefined, '', '   '])(
    'sin RABBITMQ_URL (%p) no se conecta y lo advierte: la aplicación arranca igual',
    async (url) => {
      const connect = jest.fn();
      const runner = new RabbitMqCheckoutRunner(configWith(url), () => useCase, connect);

      await runner.onApplicationBootstrap();

      expect(connect).not.toHaveBeenCalled();
      expect(runner.isConsuming).toBe(false);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('RABBITMQ_URL'));
    },
  );

  it('declara la topología, crea el publicador con confirms y consume modulo3.checkout con prefetch(1)', async () => {
    const connection = new FakeConnection();
    const publishers: CheckoutMessagePublisherPort[] = [];
    const runner = new RabbitMqCheckoutRunner(
      configWith('amqp://broker'),
      (publisher) => {
        publishers.push(publisher);
        return useCase;
      },
      async () => connection as unknown as ChannelModel,
    );

    await runner.onApplicationBootstrap();

    const [setup, , consumer] = connection.channels;
    expect(setup.queues).toEqual([
      CHECKOUT_QUEUE,
      CHECKOUT_RETRY_QUEUE,
      CHECKOUT_DEAD_LETTER_QUEUE,
    ]);
    expect(setup.closed).toBe(true);
    expect(connection.confirmChannels).toBe(1);
    expect(publishers).toHaveLength(1);
    expect(consumer.consumed).toEqual([CHECKOUT_QUEUE]);
    expect(consumer.prefetchCount).toBe(1);
    expect(runner.isConsuming).toBe(true);
  });

  it('al apagar cierra la conexión y no intenta reconectarse', async () => {
    jest.useFakeTimers();
    const connection = new FakeConnection();
    const connect = jest.fn(async () => connection as unknown as ChannelModel);
    const runner = new RabbitMqCheckoutRunner(
      configWith('amqp://broker'),
      () => useCase,
      connect,
      10,
    );
    await runner.onApplicationBootstrap();

    await runner.onApplicationShutdown();
    jest.advanceTimersByTime(100);

    expect(connection.closed).toBe(true);
    expect(connect).toHaveBeenCalledTimes(1);
    expect(runner.isConsuming).toBe(false);
  });

  it('si el broker no responde, lo registra y reintenta hasta conectarse', async () => {
    jest.useFakeTimers();
    const connection = new FakeConnection();
    const connect = jest
      .fn()
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValue(connection);
    const runner = new RabbitMqCheckoutRunner(
      configWith('amqp://broker'),
      () => useCase,
      connect,
      10,
    );

    await runner.onApplicationBootstrap();
    expect(error).toHaveBeenCalledWith(expect.stringContaining('ECONNREFUSED'));
    expect(runner.isConsuming).toBe(false);

    await jest.advanceTimersByTimeAsync(10);

    expect(connect).toHaveBeenCalledTimes(2);
    expect(runner.isConsuming).toBe(true);
    await runner.onApplicationShutdown();
  });

  it('si la conexión se cae, vuelve a conectarse y a consumir', async () => {
    jest.useFakeTimers();
    const first = new FakeConnection();
    const second = new FakeConnection();
    const connect = jest.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    const runner = new RabbitMqCheckoutRunner(
      configWith('amqp://broker'),
      () => useCase,
      connect,
      10,
    );
    await runner.onApplicationBootstrap();

    first.emit('close');
    expect(runner.isConsuming).toBe(false);
    await jest.advanceTimersByTimeAsync(10);

    expect(connect).toHaveBeenCalledTimes(2);
    expect(second.channels[2].consumed).toEqual([CHECKOUT_QUEUE]);
    expect(runner.isConsuming).toBe(true);
    await runner.onApplicationShutdown();
  });
});
