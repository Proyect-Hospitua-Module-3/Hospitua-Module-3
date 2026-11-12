// Feature 003 · Consultar porcentaje de comisión OTA — Módulo 2 simulado para el TC-003.
// Módulo 2 todavía no existe; este servidor responde como el contrato de reservas que
// consume 007 (GET /api/reservations/{reservationRef}, ver CLIENT-get-reservation.md de 007)
// durante el check-out real de la Sección 3 del TC-003 (HU2). La reserva usa la cotización
// que carga datos-tc-003.sql.
//
// Uso, en una terminal aparte en la carpeta Hospitua-Module-3:
//   node features/003-consultar-porcentaje-comision-ota/4-testing/modulo2-simulado.js
// Escucha en el puerto 8081 (el de MODULE2_BASE_URL en .env.example); otro puerto: PORT=9091.
//
// Reservas:
//   RES-TC003-NUEVA → canal OTA de ota-tc003-a con 18 % (distinto del 15 % histórico)
//   cualquier otra  → 404 (la reserva no existe)
// Cada petición recibida se imprime en la terminal: sirve de evidencia de qué consultó 007.
const http = require('node:http');

const PORT = Number(process.env.PORT || 8081);

const RESERVATIONS = {
  'RES-TC003-NUEVA': {
    reservationRef: 'RES-TC003-NUEVA',
    quoteIds: ['0b030000-0000-4000-8000-000000000101'],
    channel: 'OTA',
    otaId: 'ota-tc003-a',
    otaConfirmationCode: 'A-TC003-NUEVA',
    otaCommissionPercentage: 18,
  },
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

    response.setHeader('content-type', 'application/json');
    const reservation = RESERVATIONS[reservationRef];
    if (!match || !reservation) {
      response.statusCode = 404;
      response.end(JSON.stringify({ message: 'Reserva no encontrada.' }));
      return;
    }
    response.end(JSON.stringify(reservation));
  })
  .listen(PORT, () => console.log(`Módulo 2 simulado (TC-003) en http://localhost:${PORT}`));
