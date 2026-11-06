// Feature 005 · Consultar tarifa dinámica — Módulo 2 simulado para el TC-005 (HU4).
// Módulo 2 todavía no existe; este servidor responde como el contrato que consume 007
// (GET /api/reservations/{reservationRef}, ver CLIENT-get-reservation.md de 007).
//
// Uso, en una terminal aparte en la carpeta Hospitua-Module-3, con el quoteId que devolvió
// POST /pricing/quotes (la cotización de la habitación que guardó Módulo 2 en la reserva):
//   $env:QUOTE_ID = "<quoteId>"; node features/005-consultar-tarifa-dinamica/4-testing/modulo2-simulado.js
// Escucha en el puerto 8081 (el de MODULE2_BASE_URL en .env.example); otro puerto: PORT=9091.
// La OTA dueña de las reservas es la del seed (SEED_OTA_ID=booking); otra: OTA_ID=<id>.
//
// Reservas:
//   RES-OTA-PROPIA   → canal OTA, de la OTA del seed, con la cotización QUOTE_ID
//   RES-OTRA-OTA     → canal OTA, de otra OTA (expedia), con la misma cotización
//   RES-DIRECTA      → canal directo (recepción), con la misma cotización
//   RES-SIN-HABITACION → canal OTA, de la OTA del seed, con una cotización de otra habitación
//   RES-CAIDA        → 503 (Módulo 2 no disponible)
//   cualquier otra   → 404 (la reserva no existe)
const http = require('node:http');

const PORT = Number(process.env.PORT || 8081);
const QUOTE_ID = process.env.QUOTE_ID;
const OTA_ID = process.env.OTA_ID || 'booking';
const OTHER_ROOM_QUOTE_ID = 'c9d0e1f2-a3b4-4c5d-8e6f-7a8b9c0d1e2f';

if (!QUOTE_ID) {
  console.error('Falta QUOTE_ID: el quoteId que devolvió POST /pricing/quotes.');
  process.exit(1);
}

function otaReservation(reservationRef, otaId, quoteIds) {
  return {
    reservationRef,
    quoteIds,
    channel: 'OTA',
    otaId,
    otaConfirmationCode: `${otaId.toUpperCase()}-778899`,
    otaCommissionPercentage: 15,
  };
}

const RESERVATIONS = {
  'RES-OTA-PROPIA': otaReservation('RES-OTA-PROPIA', OTA_ID, [QUOTE_ID]),
  'RES-OTRA-OTA': otaReservation('RES-OTRA-OTA', 'expedia', [QUOTE_ID]),
  'RES-DIRECTA': { reservationRef: 'RES-DIRECTA', quoteIds: [QUOTE_ID], channel: 'RECEPCION' },
  'RES-SIN-HABITACION': otaReservation('RES-SIN-HABITACION', OTA_ID, [OTHER_ROOM_QUOTE_ID]),
};

http
  .createServer((request, response) => {
    const url = new URL(request.url, 'http://localhost');
    const match = /^\/api\/reservations\/([^/]+)$/.exec(url.pathname);
    const reservationRef = match ? decodeURIComponent(match[1]) : '';
    console.log(`${new Date().toISOString()}  ${request.method} ${request.url}`);

    response.setHeader('content-type', 'application/json');
    if (reservationRef === 'RES-CAIDA') {
      response.statusCode = 503;
      response.end(JSON.stringify({ message: 'Módulo 2 no disponible.' }));
      return;
    }
    const reservation = RESERVATIONS[reservationRef];
    if (!match || !reservation) {
      response.statusCode = 404;
      response.end(JSON.stringify({ message: 'Reserva no encontrada.' }));
      return;
    }
    response.end(JSON.stringify(reservation));
  })
  .listen(PORT, () =>
    console.log(
      `Módulo 2 simulado en http://localhost:${PORT} (QUOTE_ID=${QUOTE_ID}, OTA=${OTA_ID})`,
    ),
  );
