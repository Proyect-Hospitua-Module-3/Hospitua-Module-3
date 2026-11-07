// Feature 010 · Registrar Check-out
import type { Channel, ConsumeMessage } from 'amqplib';
import { RegisterCheckoutUseCase } from '../../../../domain/ports/in/checkout-ingestion/register-checkout.use-case';
import { CHECKOUT_QUEUE } from '../../../config/rabbitmq.config';

// Adaptador de entrada sin lógica de negocio: entrega el cuerpo original y los headers
// al caso de uso y traduce su resultado. ACK → ack; NACK_REQUEUE → nack con reencolado.
// Ack manual: el mensaje solo se confirma cuando el caso de uso terminó.
export class CheckoutRegisteredConsumer {
  constructor(private readonly registerCheckout: RegisterCheckoutUseCase) {}

  // Un mensaje a la vez por consumer: el siguiente llega cuando el anterior se confirma.
  async start(channel: Channel): Promise<string> {
    await channel.prefetch(1);
    const { consumerTag } = await channel.consume(
      CHECKOUT_QUEUE,
      (message) => {
        void this.handle(channel, message);
      },
      { noAck: false },
    );
    return consumerTag;
  }

  async handle(channel: Channel, message: ConsumeMessage | null): Promise<void> {
    if (!message) {
      return; // RabbitMQ canceló el consumer (por ejemplo, se borró la cola).
    }
    let result: 'ACK' | 'NACK_REQUEUE';
    try {
      result = await this.registerCheckout.register({
        body: message.content,
        headers: message.properties.headers ?? {},
      });
    } catch {
      result = 'NACK_REQUEUE';
    }
    if (result === 'ACK') {
      channel.ack(message);
    } else {
      channel.nack(message, false, true);
    }
  }
}
