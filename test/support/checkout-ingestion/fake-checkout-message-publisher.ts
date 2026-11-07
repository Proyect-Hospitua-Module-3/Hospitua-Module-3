// Feature 010 · Registrar Check-out
import { CheckoutMessagePublisherPort } from '../../../src/domain/ports/out/checkout-ingestion/checkout-message-publisher.port';

export interface PublishedMessage {
  queue: 'retry' | 'dlq';
  body: Uint8Array;
  headers: Readonly<Record<string, unknown>>;
  retryCount?: number;
}

// Doble del publicador. `failing` simula un nack, un basic.return o la falta de confirm.
export class FakeCheckoutMessagePublisher implements CheckoutMessagePublisherPort {
  readonly published: PublishedMessage[] = [];
  failing = false;

  constructor(readonly calls: string[] = []) {}

  async publishToRetry(
    body: Uint8Array,
    headers: Readonly<Record<string, unknown>>,
    retryCount: number,
  ): Promise<void> {
    this.calls.push('publishToRetry');
    this.fail();
    this.published.push({ queue: 'retry', body, headers, retryCount });
  }

  async publishToDeadLetter(
    body: Uint8Array,
    headers: Readonly<Record<string, unknown>>,
  ): Promise<void> {
    this.calls.push('publishToDeadLetter');
    this.fail();
    this.published.push({ queue: 'dlq', body, headers });
  }

  private fail(): void {
    if (this.failing) {
      throw new Error('El broker no confirmó la publicación.');
    }
  }
}
