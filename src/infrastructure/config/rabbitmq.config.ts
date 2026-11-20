// Feature 010 · Registrar Check-out
import type { Channel } from 'amqplib';

// Topología de RabbitMQ de Módulo 3 (plan base, "Convenciones de Mensajería", y
// contrato EVENT-facturacion-checkout, sección 2), ajustada a los permisos acordados con
// Módulo 1 en el broker común (vhost /): configure ^modulo3\..*$,
// read ^(modulo3\..*|hospitua\.events)$ y write ^modulo3\..*$ (sin amq.default).
export const HOSPITUA_EVENTS_EXCHANGE = 'hospitua.events';
export const CHECKOUT_ROUTING_KEY = 'facturacion.checkout';
export const CHECKOUT_QUEUE = 'modulo3.checkout';
export const CHECKOUT_RETRY_QUEUE = 'modulo3.checkout.retry.30s';
export const CHECKOUT_DEAD_LETTER_QUEUE = 'modulo3.checkout.dlq';
export const CHECKOUT_RETRY_DELAY_MS = 30_000;

// Exchange propio de Módulo 3 (direct, durable). Reemplaza al exchange por defecto, que
// permitiría escribir en cualquier cola del broker: por él se mueven los mensajes a
// reintento y a la DLQ, y por él vuelven de reintento a modulo3.checkout. Cada cola se
// enlaza con su propio nombre como routing key.
export const MODULE3_DIRECT_EXCHANGE = 'modulo3.direct';

// Declara la topología de la 010. Es idempotente: con los mismos argumentos, volver a
// declararla no cambia nada.
export async function assertCheckoutTopology(channel: Channel): Promise<void> {
  // hospitua.events lo declara Módulo 1 al arrancar (topic, durable, sin autoDelete).
  // Módulo 3 solo verifica que existe; si no existe, el broker cierra el canal (404) y
  // el runner reintenta la conexión.
  await channel.checkExchange(HOSPITUA_EVENTS_EXCHANGE);

  await channel.assertExchange(MODULE3_DIRECT_EXCHANGE, 'direct', {
    durable: true,
    autoDelete: false,
  });

  // Cola principal: enlazada a facturacion.checkout, nunca a habitacion.checkout (ese
  // mensaje lleva datos migratorios para Módulo 2), y a modulo3.direct para recibir los
  // mensajes que vuelven de reintento.
  await channel.assertQueue(CHECKOUT_QUEUE, { durable: true });
  await channel.bindQueue(CHECKOUT_QUEUE, HOSPITUA_EVENTS_EXCHANGE, CHECKOUT_ROUTING_KEY);
  await channel.bindQueue(CHECKOUT_QUEUE, MODULE3_DIRECT_EXCHANGE, CHECKOUT_QUEUE);

  // Reintento diferido: sin binding a hospitua.events. Al vencer el TTL, el broker
  // devuelve el mensaje a modulo3.checkout por modulo3.direct.
  await channel.assertQueue(CHECKOUT_RETRY_QUEUE, {
    durable: true,
    arguments: {
      'x-message-ttl': CHECKOUT_RETRY_DELAY_MS,
      'x-dead-letter-exchange': MODULE3_DIRECT_EXCHANGE,
      'x-dead-letter-routing-key': CHECKOUT_QUEUE,
    },
  });
  await channel.bindQueue(CHECKOUT_RETRY_QUEUE, MODULE3_DIRECT_EXCHANGE, CHECKOUT_RETRY_QUEUE);

  // Revisión manual: sin binding a hospitua.events. No se declara hospitua.events.dlx.
  await channel.assertQueue(CHECKOUT_DEAD_LETTER_QUEUE, { durable: true });
  await channel.bindQueue(
    CHECKOUT_DEAD_LETTER_QUEUE,
    MODULE3_DIRECT_EXCHANGE,
    CHECKOUT_DEAD_LETTER_QUEUE,
  );
}
