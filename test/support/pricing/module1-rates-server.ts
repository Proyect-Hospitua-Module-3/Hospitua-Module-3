// Feature 005 · Consultar tarifa dinámica
// Módulo 1 simulado que responde GET /api/rooms/{roomId}/base-rate?date= según la fecha,
// para probar rangos de varias noches con el cliente HTTP real de 004.
import { AddressInfo } from 'node:net';
import { createServer, Server } from 'node:http';

export type Module1RateReply =
  | { kind: 'rate'; baseRate: string }
  | { kind: 'roomNotFound' }
  | { kind: 'unavailable' };

export class Module1RatesServer {
  private server?: Server;
  baseUrl = '';
  defaultBaseRate = '300000.00';
  // Respuestas especiales por fecha (YYYY-MM-DD); las demás devuelven defaultBaseRate.
  replies = new Map<string, Module1RateReply>();
  requests: { roomId: string; date: string }[] = [];

  async start(): Promise<void> {
    this.server = createServer((request, response) => {
      const url = new URL(request.url ?? '/', 'http://localhost');
      const match = /^\/api\/rooms\/([^/]+)\/base-rate$/.exec(url.pathname);
      const roomId = decodeURIComponent(match?.[1] ?? '');
      const date = url.searchParams.get('date') ?? '';
      this.requests.push({ roomId, date });

      const reply = this.replies.get(date) ?? { kind: 'rate', baseRate: this.defaultBaseRate };
      response.setHeader('content-type', 'application/json');
      if (reply.kind === 'roomNotFound') {
        response.statusCode = 404;
        response.end(
          JSON.stringify({ errorCode: 'ROOM_NOT_FOUND', message: 'Habitación no encontrada.' }),
        );
      } else if (reply.kind === 'unavailable') {
        response.statusCode = 503;
        response.end(JSON.stringify({ message: 'Módulo 1 en mantenimiento.' }));
      } else {
        response.statusCode = 200;
        response.end(JSON.stringify({ roomId, date, baseRate: reply.baseRate, currency: 'COP' }));
      }
    });
    const server = this.server;
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        server.off('error', reject);
        resolve();
      });
    });
    this.baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = undefined;
    if (!server) return;
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}
