import { AddressInfo } from 'node:net';
import { createServer, Server, ServerResponse } from 'node:http';

export type Module1Reply = {
  status: number;
  body?: unknown;
  rawBody?: string;
  delayMs?: number;
  dropConnection?: boolean;
};

export class Module1HttpFixture {
  private server?: Server;
  private reply: Module1Reply = { status: 200, body: {} };
  private queuedReplies: Module1Reply[] = [];
  requests = 0;
  baseUrl = '';

  async start(): Promise<void> {
    this.server = createServer((_request, response) => {
      this.requests += 1;
      this.send(response, this.queuedReplies.shift() ?? this.reply);
    });
    await new Promise<void>((resolve) => this.server?.listen(0, '127.0.0.1', resolve));
    const address = this.server?.address() as AddressInfo;
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
