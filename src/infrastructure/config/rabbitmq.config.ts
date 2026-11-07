// Feature 010 · Registrar Check-out
import type { Channel } from 'amqplib';

// Topología de RabbitMQ de Módulo 3 (plan base, "Convenciones de Mensajería", y
// contrato EVENT-facturacion-checkout, sección 2).
export const HOSPITUA_EVENTS_EXCHANGE = 'hospitua.events';
export const CHECKOUT_ROUTING_KEY = 'facturacion.checkout';
export const CHECKOUT_QUEUE = 'modulo3.checkout';
export const CHECKOUT_RETRY_QUEUE = 'modulo3.checkout.retry.30s';
export const CHECKOUT_DEAD_LETTER_QUEUE = 'modulo3.checkout.dlq';
export const CHECKOUT_RETRY_DELAY_MS = 30_000;

// Declara la topología de la 010. Es idempotente: con los mismos argumentos, volver a
// declararla no cambia nada. El exchange se declara igual que Módulo 1 (topic,
// durable, sin autoDelete); con otros argumentos RabbitMQ respondería PRECONDITION_FAILED.
export async function assertCheckoutTopology(channel: Channel): Promise<void> {
  await channel.assertExchange(HOSPITUA_EVENTS_EXCHANGE, 'topic', {
    durable: true,
    autoDelete: false,
  });

  // Cola principal: solo enlazada a facturacion.checkout, nunca a habitacion.checkout
  // (ese mensaje lleva datos migratorios para Módulo 2).
  await channel.assertQueue(CHECKOUT_QUEUE, { durable: true });
  await channel.bindQueue(CHECKOUT_QUEUE, HOSPITUA_EVENTS_EXCHANGE, CHECKOUT_ROUTING_KEY);

  // Reintento diferido: sin binding a hospitua.events. Al vencer el TTL, el broker
  // devuelve el mensaje a modulo3.checkout por el exchange por defecto.
  await channel.assertQueue(CHECKOUT_RETRY_QUEUE, {
    durable: true,
    arguments: {
      'x-message-ttl': CHECKOUT_RETRY_DELAY_MS,
      'x-dead-letter-exchange': '',
      'x-dead-letter-routing-key': CHECKOUT_QUEUE,
    },
  });

  // Revisión manual: sin binding a hospitua.events. No se declara hospitua.events.dlx.
  await channel.assertQueue(CHECKOUT_DEAD_LETTER_QUEUE, { durable: true });
}
