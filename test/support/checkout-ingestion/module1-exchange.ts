// Feature 010 · Registrar Check-out
// En el broker común, hospitua.events lo declara Módulo 1 al arrancar y Módulo 3 solo lo
// verifica (checkExchange). En un broker de pruebas vacío se declara aquí, con los mismos
// argumentos que Módulo 1, antes de la topología de Módulo 3.
import type { Channel } from 'amqplib';
import { HOSPITUA_EVENTS_EXCHANGE } from '../../../src/infrastructure/config/rabbitmq.config';

export async function declareModule1Exchange(channel: Channel): Promise<void> {
  await channel.assertExchange(HOSPITUA_EVENTS_EXCHANGE, 'topic', {
    durable: true,
    autoDelete: false,
  });
}
