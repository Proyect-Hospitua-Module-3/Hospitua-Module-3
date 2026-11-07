// Feature 010 · Registrar Check-out — recuperación manual desde la DLQ (T016).
// Procedimiento completo en 3-implementation/implementacion.md, sección "Recuperación desde
// la DLQ". Resumen:
//   1. Corregir la causa (p. ej., registrar el IVA en PUT /admin/vat-rate).
//   2. Pasar el registro de auditoría a PENDING (consulta 6 de revisar-auditoria-checkout.sql).
//   3. Ejecutar este script con el eventId:
//        $env:EVENT_ID = "<eventId>"; node features/010-registrar-checkout/4-testing/recuperar-desde-dlq.js
//
// Busca el mensaje en `modulo3.checkout.dlq` y lo vuelve a publicar en `modulo3.checkout` por
// el exchange por defecto, persistente, con `mandatory` y `x-retry-count = 0` (nuevo ciclo de
// reintentos). Solo después del publisher confirm y sin `basic.return` lo quita de la DLQ.
// Las copias duplicadas del mismo eventId (la DLQ puede recibirlas) se descartan; los demás
// mensajes vuelven a la DLQ sin cambios.
const { connect } = require('amqplib');

const DLQ = 'modulo3.checkout.dlq';
const CHECKOUT_QUEUE = 'modulo3.checkout';

function eventIdOf(message) {
  try {
    return JSON.parse(message.content.toString('utf8')).eventId ?? null;
  } catch {
    return null;
  }
}

function publishConfirmed(channel, message) {
  return new Promise((resolve, reject) => {
    let returned = false;
    const onReturn = () => {
      returned = true;
    };
    channel.once('return', onReturn);
    channel.publish(
      '',
      CHECKOUT_QUEUE,
      message.content,
      {
        ...message.properties,
        persistent: true,
        mandatory: true,
        headers: { ...(message.properties.headers ?? {}), 'x-retry-count': 0 },
      },
      (error) => {
        channel.removeListener('return', onReturn);
        if (error) reject(new Error('El broker no confirmó la publicación.'));
        else if (returned)
          reject(new Error(`El broker devolvió el mensaje: ${CHECKOUT_QUEUE} no existe.`));
        else resolve();
      },
    );
  });
}

async function main() {
  const eventId = process.env.EVENT_ID;
  if (!eventId) {
    console.error('Falta EVENT_ID: el eventId del mensaje que se quiere recuperar.');
    process.exit(1);
  }
  const url = process.env.RABBITMQ_URL || 'amqp://hospitua:hospitua@localhost:5672';
  const connection = await connect(url);
  const channel = await connection.createConfirmChannel();
  const others = [];
  let recovered = 0;
  try {
    const { messageCount } = await channel.checkQueue(DLQ);
    for (let index = 0; index < messageCount; index++) {
      const message = await channel.get(DLQ, { noAck: false });
      if (!message) break;
      if (eventIdOf(message) !== eventId) {
        others.push(message);
      } else if (recovered === 0) {
        await publishConfirmed(channel, message);
        channel.ack(message);
        recovered += 1;
      } else {
        channel.ack(message); // copia duplicada del mismo eventId
        recovered += 1;
      }
    }
  } finally {
    for (const message of others) channel.nack(message, false, true);
    await channel.close().catch(() => undefined);
    await connection.close();
  }
  if (recovered === 0) {
    console.log(`No hay ningún mensaje con eventId ${eventId} en ${DLQ}.`);
    process.exit(2);
  }
  console.log(
    `Mensaje ${eventId} publicado de nuevo en ${CHECKOUT_QUEUE} con x-retry-count = 0` +
      (recovered > 1 ? ` (${recovered - 1} copia(s) duplicada(s) descartada(s)).` : '.'),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
