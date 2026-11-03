import { AddressInfo } from 'node:net';
import { createServer, Server, ServerResponse } from 'node:http';

export type Module1Reply = {
  status: number;
  body?: unknown;
  rawBody?: string;
  delayMs?: number;
  dropConnection?: boolean;
};

export type Module1Request = {
  method: string;
  url: string;
};

export class Module1HttpFixture {
  private server?: Server;
  private reply: Module1Reply = { status: 200, body: {} };
  private queuedReplies: Module1Reply[] = [];
  requests = 0;
  requestLog: Module1Request[] = [];
  baseUrl = '';

  async start(): Promise<void> {
    this.server = createServer((request, response) => {
      this.requests += 1;
      this.requestLog.push({ method: request.method ?? '', url: request.url ?? '' });
      this.send(response, this.queuedReplies.shift() ?? this.reply);
    });
    const server = this.server;
    await new Promise<void>((resolve, reject) => {
      const onListening = (): void => {
        server.off('error', onError);
        resolve();
      };
      const onError = (error: Error): void => {
        server.off('listening', onListening);
        this.server = undefined;
        reject(error);
      };
      server.once('listening', onListening);
      server.once('error', onError);
      server.listen(0, '127.0.0.1');
    });
    const address = server.address() as AddressInfo;
    this.baseUrl = `http://127.0.0.1:${address.port}`;
  }

  setReply(reply: Module1Reply): void {
    this.reply = reply;
  }

  setReplies(replies: Module1Reply[]): void {
    this.queuedReplies = [...replies];
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    await new Promise<void>((resolve, reject) =>
      this.server?.close((error) => (error ? reject(error) : resolve())),
    );
    this.server = undefined;
  }

  private send(response: ServerResponse, reply: Module1Reply): void {
    const sendResponse = (): void => {
      if (reply.dropConnection) {
        response.destroy();
        return;
      }
      response.statusCode = reply.status;
      response.setHeader('content-type', 'application/json');
      if (reply.rawBody !== undefined) response.end(reply.rawBody);
      else if (reply.body === undefined) response.end();
      else response.end(JSON.stringify(reply.body));
    };
    if (reply.delayMs) setTimeout(sendResponse, reply.delayMs);
    else sendResponse();
  }
}
