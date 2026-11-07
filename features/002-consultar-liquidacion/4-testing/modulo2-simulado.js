// Feature 002 · Consultar liquidación — Módulo 2 simulado para el TC-002.
// Módulo 2 todavía no existe; este servidor responde como el contrato de reservas que
// consume 007 (GET /api/reservations/{reservationRef}, ver CLIENT-get-reservation.md de 007).
// Las reservas usan las cotizaciones que carga datos-tc-002.sql.
//
// Uso, en una terminal aparte en la carpeta Hospitua-Module-3:
//   node features/002-consultar-liquidacion/4-testing/modulo2-simulado.js
// Escucha en el puerto 8081 (el de MODULE2_BASE_URL en .env.example); otro puerto: PORT=9091.
// Para simular un Módulo 2 lento (paso de tiempos): DELAY_MS=450 (debe ser menor que
// MODULE2_TIMEOUT_MS, 500 por defecto).
//
// Reservas:
//   RES-TC002-OTA               → canal OTA de booking (15 %), habitaciones 101, 102 y 103
//   RES-TC002-DIRECTA           → sin canal (directo), habitaciones 201 y 202
//   RES-TC002-EXPEDIA           → canal OTA de expedia (18 %), habitación 301
//   RES-TC002-SIN-COMISION      → canal OTA de booking sin comisión, habitación 103
//   RES-TC002-COMISION-INVALIDA → canal OTA de booking con comisión 150, habitación 103
//   RES-TC002-CAIDA             → 503 (Módulo 2 no disponible)
//   cualquier otra              → 404 (la reserva no existe)
const http = require('node:http');

const PORT = Number(process.env.PORT || 8081);
const DELAY_MS = Number(process.env.DELAY_MS || 0);

const quote = (room) => `0b020000-0000-4000-8000-000000000${room}`;

function ota(reservationRef, otaId, otaCommissionPercentage, rooms) {
  return {
    reservationRef,
    quoteIds: rooms.map(quote),
    channel: 'OTA',
    otaId,
    otaConfirmationCode: otaId === 'booking' ? 'BKG-TC002' : 'EXP-TC002',
    otaCommissionPercentage,
  };
}

const RESERVATIONS = {
  'RES-TC002-OTA': ota('RES-TC002-OTA', 'booking', 15, [101, 102, 103]),
  'RES-TC002-DIRECTA': {
    reservationRef: 'RES-TC002-DIRECTA',
    quoteIds: [quote(201), quote(202)],
    channel: null,
  },
  'RES-TC002-EXPEDIA': ota('RES-TC002-EXPEDIA', 'expedia', 18, [301]),
  'RES-TC002-SIN-COMISION': ota('RES-TC002-SIN-COMISION', 'booking', null, [103]),
  'RES-TC002-COMISION-INVALIDA': ota('RES-TC002-COMISION-INVALIDA', 'booking', 150, [103]),
};

http
  .createServer((request, response) => {
    const url = new URL(request.url, 'http://localhost');
    const match = /^\/api\/reservations\/([^/]+)$/.exec(url.pathname);
    const reservationRef = match ? decodeURIComponent(match[1]) : '';
    const correlationId = request.headers['x-correlation-id'] ?? '-';
    console.log(
      `${new Date().toISOString()}  ${request.method} ${request.url}  X-Correlation-Id: ${correlationId}`,
    );

    const reply = () => {
      response.setHeader('content-type', 'application/json');
      if (reservationRef === 'RES-TC002-CAIDA') {
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
    };
    if (DELAY_MS > 0) setTimeout(reply, DELAY_MS);
    else reply();
  })
  .listen(PORT, () =>
    console.log(`Módulo 2 simulado en http://localhost:${PORT} (demora ${DELAY_MS} ms)`),
  );
