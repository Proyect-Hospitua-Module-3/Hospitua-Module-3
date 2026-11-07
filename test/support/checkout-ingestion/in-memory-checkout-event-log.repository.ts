// Feature 010 · Registrar Check-out
import {
  CheckoutEventLog,
  NewCheckoutEventLog,
} from '../../../src/domain/model/checkout-ingestion/checkout-event-log';
import { CheckoutStatus } from '../../../src/domain/model/checkout-ingestion/checkout-status.enum';
import { CheckoutEventLogRepositoryPort } from '../../../src/domain/ports/out/checkout-ingestion/checkout-event-log.repository.port';

type Operation = keyof CheckoutEventLogRepositoryPort;

// Doble del puerto de auditoría con las mismas reglas que el repositorio Prisma:
// deduplica por eventId y solo cierra registros PENDING.
export class InMemoryCheckoutEventLogRepository implements CheckoutEventLogRepositoryPort {
  readonly logs: CheckoutEventLog[] = [];
  // Operaciones que fallan, para simular DATABASE_UNAVAILABLE.
  readonly failing = new Set<Operation>();
  // Orden de llamadas, compartido con el publicador para comprobar la secuencia.
  constructor(readonly calls: string[] = []) {}

  byEventId(eventId: string): CheckoutEventLog | undefined {
    return this.logs.find((log) => log.eventId === eventId);
  }

  async registerIfAbsent(eventLog: NewCheckoutEventLog): Promise<CheckoutEventLog> {
    this.record('registerIfAbsent');
    const existing = this.byEventId(eventLog.eventId);
    if (existing) {
      return existing;
    }
    const created = new CheckoutEventLog(
      `log-${this.logs.length + 1}`,
      eventLog.eventId,
      eventLog.eventType,
      eventLog.occurredAt,
      eventLog.payload,
      eventLog.stayId,
      'PENDING',
      null,
      null,
      null,
      null,
      new Date(),
    );
    this.logs.push(created);
    return created;
  }

  async markProcessed(eventId: string, resultNote: string | null = null): Promise<void> {
    this.record('markProcessed');
    this.close(eventId, 'PROCESSED', null, null, resultNote);
  }

  async markRejected(eventId: string, errorCode: string, reason: string): Promise<void> {
    this.record('markRejected');
    this.close(eventId, 'REJECTED', errorCode, reason, null);
  }

  async markDeadLetter(eventId: string, errorCode: string, reason: string): Promise<void> {
    this.record('markDeadLetter');
    this.close(eventId, 'DEAD_LETTER', errorCode, reason, null);
  }

  async registerUnrecognizedEnvelopeRejection(reason: string): Promise<void> {
    this.record('registerUnrecognizedEnvelopeRejection');
    this.logs.push(
      new CheckoutEventLog(
        `log-${this.logs.length + 1}`,
        null,
        null,
        null,
        null,
        null,
        'REJECTED',
        'INVALID_CHECKOUT_EVENT',
        reason,
        null,
        new Date(),
        new Date(),
      ),
    );
  }

  private record(operation: Operation): void {
    this.calls.push(operation);
    if (this.failing.has(operation)) {
      throw new Error(`Base de datos no disponible (${operation}).`);
    }
  }

  private close(
    eventId: string,
    status: CheckoutStatus,
    errorCode: string | null,
    reason: string | null,
    resultNote: string | null,
  ): void {
    const index = this.logs.findIndex((log) => log.eventId === eventId && log.isPending);
    if (index < 0) {
      return;
    }
    const log = this.logs[index];
    this.logs[index] = new CheckoutEventLog(
      log.id,
      log.eventId,
      log.eventType,
      log.occurredAt,
      log.payload,
      log.stayId,
      status,
      errorCode,
      reason,
      resultNote,
      new Date(),
      log.createdAt,
    );
  }
}
