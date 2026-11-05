// Feature 005 · Consultar tarifa dinámica — Módulo 1 simulado para el TC-005.
// Módulo 1 todavía no existe; este servidor responde como su contrato
// (GET /api/rooms/{roomId}/base-rate?date=YYYY-MM-DD, ver CLIENT-get-base-rate.md de 004).
//
// Uso, en una terminal aparte en la carpeta Hospitua-Module-3:
//   node features/005-consultar-tarifa-dinamica/4-testing/modulo1-simulado.js
// Escucha en el puerto 8080 (el de MODULE1_BASE_URL en .env.example); otro puerto: PORT=9090.
//
// Habitaciones:
//   cualquier UUID                          → tarifa base 300000.00 COP todas las noches
//   99999999-0000-4000-8000-000000000000    → 404 ROOM_NOT_FOUND (la habitación no existe)
//   88888888-0000-4000-8000-000000000000    → tarifa base 0.00 (Módulo 1 reporta una tarifa inválida)
const http = require('node:http');

const PORT = Number(process.env.PORT || 8080);
const MISSING_ROOM = '99999999-0000-4000-8000-000000000000';
const ZERO_RATE_ROOM = '88888888-0000-4000-8000-000000000000';

http
  .createServer((request, response) => {
    const url = new URL(request.url, 'http://localhost');
    const match = /^\/api\/rooms\/([^/]+)\/base-rate$/.exec(url.pathname);
    const roomId = match ? decodeURIComponent(match[1]).toLowerCase() : '';
    const date = url.searchParams.get('date');
    console.log(`${new Date().toISOString()}  ${request.method} ${request.url}`);

    response.setHeader('content-type', 'application/json');
    if (!match || !date) {
      response.statusCode = 400;
      response.end(
        JSON.stringify({ errorCode: 'INVALID_REQUEST', message: 'Ruta o fecha inválida.' }),
      );
      return;
    }
    if (roomId === MISSING_ROOM) {
      response.statusCode = 404;
      response.end(
        JSON.stringify({ errorCode: 'ROOM_NOT_FOUND', message: 'Habitación no encontrada.' }),
      );
      return;
    }
    const baseRate = roomId === ZERO_RATE_ROOM ? '0.00' : '300000.00';
    response.end(JSON.stringify({ roomId, date, baseRate, currency: 'COP' }));
  })
  .listen(PORT, () => console.log(`Módulo 1 simulado en http://localhost:${PORT}`));
