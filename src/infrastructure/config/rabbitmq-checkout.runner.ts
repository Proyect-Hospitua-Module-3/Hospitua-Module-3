// Feature 010 · Registrar Check-out
import { Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChannelModel, connect } from 'amqplib';
import { RegisterCheckoutUseCase } from '../../domain/ports/in/checkout-ingestion/register-checkout.use-case';
import { CheckoutMessagePublisherPort } from '../../domain/ports/out/checkout-ingestion/checkout-message-publisher.port';
import { CheckoutRegisteredConsumer } from '../adapters/in/messaging/checkout-registered.consumer';
import { RabbitMqCheckoutMessagePublisher } from '../adapters/out/messaging/rabbitmq-checkout-message-publisher.adapter';
import { assertCheckoutTopology } from './rabbitmq.config';

export const RECONNECT_DELAY_MS = 5_000;

export type AmqpConnect = (url: string) => Promise<ChannelModel>;

// Arranca la entrada de mensajes de la 010 (T011): declara la topología, abre un canal
// con publisher confirms para retry y DLQ, y consume `modulo3.checkout` con ack manual y
// prefetch(1).
//
// RABBITMQ_URL es opcional: sin ella la aplicación arranca igual (las demás features no
// dependen del broker) y los eventos de Módulo 1 esperan en la cola hasta que el consumer
// se active. Si el broker no responde o cierra la conexión, se reintenta cada 5 s; los
// mensajes sin ack vuelven a la cola, así que no se pierde ninguno.
export class RabbitMqCheckoutRunner implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('CheckoutIngestion');
  private connection?: ChannelModel;
  private reconnectTimer?: NodeJS.Timeout;
  private stopping = false;

  constructor(
    private readonly config: ConfigService,
    private readonly createUseCase: (
      publisher: CheckoutMessagePublisherPort,
    ) => RegisterCheckoutUseCase,
    private readonly connectTo: AmqpConnect = connect,
    private readonly reconnectDelayMs = RECONNECT_DELAY_MS,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const url = this.config.get<string>('RABBITMQ_URL')?.trim();
    if (!url) {
      this.logger.warn(
        'RABBITMQ_URL no está configurada: no se consume modulo3.checkout (feature 010). Los check-out esperan en la cola.',
      );
      return;
    }
    await this.start(url);
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopping = true;
    clearTimeout(this.reconnectTimer);
    // Cerrar la conexión devuelve a la cola cualquier mensaje sin ack.
    await this.connection?.close().catch(() => undefined);
    this.connection = undefined;
  }

  get isConsuming(): boolean {
    return this.connection !== undefined;
  }

  private async start(url: string): Promise<void> {
    try {
      const connection = await this.connectTo(url);
      connection.on('error', (error: unknown) => {
        this.logger.error(`Error en la conexión con RabbitMQ: ${messageOf(error)}`);
      });
      connection.on('close', () => {
        if (this.connection !== connection) return;
        this.connection = undefined;
        if (!this.stopping) {
          this.logger.error('Se cerró la conexión con RabbitMQ; se reintenta.');
          this.scheduleReconnect(url);
        }
      });

      const setup = await connection.createChannel();
      await assertCheckoutTopology(setup);
      await setup.close();

      const publisher = new RabbitMqCheckoutMessagePublisher(
        await connection.createConfirmChannel(),
      );
      const consumer = new CheckoutRegisteredConsumer(this.createUseCase(publisher));
      await consumer.start(await connection.createChannel());

      this.connection = connection;
      this.logger.log('Consumiendo modulo3.checkout (feature 010).');
    } catch (error) {
      this.logger.error(`No se pudo conectar con RabbitMQ: ${messageOf(error)}; se reintenta.`);
      this.scheduleReconnect(url);
    }
  }

  private scheduleReconnect(url: string): void {
    if (this.stopping) return;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => void this.start(url), this.reconnectDelayMs);
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
