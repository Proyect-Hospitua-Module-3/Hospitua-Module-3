// Feature 010 · Registrar Check-out — Módulo 1 simulado para el TC-010.
// Módulo 1 todavía no publica eventos; este script publica un `facturacion.checkout` en
// `hospitua.events` tal como lo describe el contrato EVENT-facturacion-checkout.md.
//
// Uso, en la carpeta Hospitua-Module-3 (con RabbitMQ levantado: docker compose up -d):
//   $env:ROOM_ID = "<roomId de la cotización>"; node features/010-registrar-checkout/4-testing/publicar-checkout.js
//
// Variables (todas opcionales salvo ROOM_ID):
//   RABBITMQ_URL           amqp://hospitua:hospitua@localhost:5672 por defecto
//   ROOM_ID                habitación de la cotización que devolvió POST /pricing/quotes (obligatoria)
//   RESERVATION_REF        reserva del Módulo 2 simulado de la 005 (por defecto RES-DIRECTA;
//                          también RES-OTA-PROPIA, RES-CAIDA para Módulo 2 caído o RES-NO-EXISTE)
//   STAY_ID / EVENT_ID     UUID; por defecto se generan. Repite EVENT_ID para simular una reentrega
//                          y STAY_ID (con otro EVENT_ID) para un segundo evento de la misma estancia
//   CHECK_IN / CHECK_OUT   fechas reales, por defecto 2026-12-20 y 2026-12-23
//   SIN_DATOS_TRIBUTARIOS  1 → el evento no trae billingCustomer (la factura no se emite)
//   SIN_STAY_ID            1 → evento inválido (va a la DLQ como INVALID_CHECKOUT_EVENT)
//   NO_JSON                1 → cuerpo que no es JSON (sobre no reconocible)
const { randomUUID } = require('node:crypto');
const { connect } = require('amqplib');

const EXCHANGE = 'hospitua.events';
const ROUTING_KEY = 'facturacion.checkout';

function eventBody() {
  if (process.env.NO_JSON === '1') return Buffer.from('esto no es JSON');
  if (!process.env.ROOM_ID) {
    console.error(
      'Falta ROOM_ID: la habitación de la cotización que devolvió POST /pricing/quotes.',
    );
    process.exit(1);
  }
  const payload = {
    stayId: process.env.STAY_ID || randomUUID(),
    reservationRef: process.env.RESERVATION_REF || 'RES-DIRECTA',
    roomId: process.env.ROOM_ID,
    categoryRoom: 'DOBLE',
    checkInDate: process.env.CHECK_IN || '2026-12-20',
    checkOutDate: process.env.CHECK_OUT || '2026-12-23',
  };
  if (process.env.SIN_DATOS_TRIBUTARIOS !== '1') {
    payload.billingCustomer = { name: 'Comercializadora Andina S.A.S.', taxId: '900123456-7' };
  }
  if (process.env.SIN_STAY_ID === '1') delete payload.stayId;
  return Buffer.from(
    JSON.stringify({
      eventId: process.env.EVENT_ID || randomUUID(),
      eventType: 'CHECK_OUT',
      occurredAt: new Date().toISOString(),
      sourceModule: 'MODULE_1',
      payload,
    }),
  );
}

async function main() {
  const body = eventBody();
  const url = process.env.RABBITMQ_URL || 'amqp://hospitua:hospitua@localhost:5672';
  const connection = await connect(url);
  try {
    const channel = await connection.createConfirmChannel();
    // Mismos argumentos con los que lo declaran Módulo 1 y Módulo 3.
    await channel.assertExchange(EXCHANGE, 'topic', { durable: true, autoDelete: false });
    channel.publish(EXCHANGE, ROUTING_KEY, body, {
      persistent: true,
      contentType: 'application/json',
    });
    await channel.waitForConfirms();
    console.log(`Publicado en ${EXCHANGE} (${ROUTING_KEY}):`);
    console.log(body.toString());
  } finally {
    await connection.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
