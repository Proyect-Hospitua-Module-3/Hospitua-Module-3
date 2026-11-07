// Feature 010 · Registrar Check-out
import type { ConfirmChannel } from 'amqplib';
import { CheckoutMessagePublisherPort } from '../../../../domain/ports/out/checkout-ingestion/checkout-message-publisher.port';
import { CHECKOUT_DEAD_LETTER_QUEUE, CHECKOUT_RETRY_QUEUE } from '../../../config/rabbitmq.config';

export const DEFAULT_CONFIRM_TIMEOUT_MS = 10_000;

// Publica a la cola de reintento o a la DLQ por el exchange por defecto, con mensajes
// persistentes y `mandatory`. Cada promesa se resuelve solo con publisher confirm y sin
// `basic.return`; un nack, una devolución, el cierre del canal o la falta de
// confirmación a tiempo la rechazan.
//
// Las publicaciones van de una en una por canal: RabbitMQ envía el `basic.return` de un
// mensaje antes de su confirmación, así que una devolución que llega mientras una
// publicación espera su confirm solo puede ser de esa publicación.
export class RabbitMqCheckoutMessagePublisher implements CheckoutMessagePublisherPort {
  private pending: Promise<unknown> = Promise.resolve();
  private returned = false;

  constructor(
    private readonly channel: ConfirmChannel,
    private readonly confirmTimeoutMs = DEFAULT_CONFIRM_TIMEOUT_MS,
  ) {
    channel.on('return', () => {
      this.returned = true;
    });
  }

  publishToRetry(
    body: Uint8Array,
    headers: Readonly<Record<string, unknown>>,
    retryCount: number,
  ): Promise<void> {
    return this.enqueue(CHECKOUT_RETRY_QUEUE, body, { ...headers, 'x-retry-count': retryCount });
  }

  publishToDeadLetter(body: Uint8Array, headers: Readonly<Record<string, unknown>>): Promise<void> {
    return this.enqueue(CHECKOUT_DEAD_LETTER_QUEUE, body, { ...headers });
  }

  private enqueue(
    queue: string,
    body: Uint8Array,
    headers: Record<string, unknown>,
  ): Promise<void> {
    const publication = this.pending.then(() => this.publish(queue, body, headers));
    this.pending = publication.catch(() => undefined);
    return publication;
  }

  private publish(
    queue: string,
    body: Uint8Array,
    headers: Record<string, unknown>,
  ): Promise<void> {
    this.returned = false;
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () =>
          reject(new Error(`Sin publisher confirm de ${queue} en ${this.confirmTimeoutMs} ms.`)),
        this.confirmTimeoutMs,
      );
      try {
        this.channel.publish(
          '',
          queue,
          Buffer.from(body),
          { persistent: true, mandatory: true, headers },
          (error: unknown) => {
            clearTimeout(timer);
            if (error) {
              reject(new Error(`El broker no confirmó la publicación a ${queue}.`));
            } else if (this.returned) {
              reject(
                new Error(`El broker devolvió el mensaje (basic.return): ${queue} no existe.`),
              );
            } else {
              resolve();
            }
          },
        );
      } catch (error) {
        clearTimeout(timer);
        reject(error);
      }
    });
  }
}
