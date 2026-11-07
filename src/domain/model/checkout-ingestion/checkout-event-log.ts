// Feature 010 · Registrar Check-out
import { CheckoutAuditPayload, RecognizedCheckoutEnvelope } from './checkout-event';
import { CheckoutStatus } from './checkout-status.enum';

// Registro nuevo en PENDING de un sobre reconocible, antes de validarlo.
export interface NewCheckoutEventLog {
  eventId: string;
  eventType: string | null;
  occurredAt: Date | null;
  payload: CheckoutAuditPayload;
  stayId: string | null;
}

export function pendingCheckoutEventLog(envelope: RecognizedCheckoutEnvelope): NewCheckoutEventLog {
  return {
    eventId: envelope.eventId,
    eventType: envelope.eventType,
    occurredAt: envelope.occurredAt,
    payload: envelope.auditPayload(),
    stayId: envelope.stayId,
  };
}

// Fila de `checkout_event_log`: el resultado de cada evento recibido (NFR-004). No
// guarda el cuerpo crudo, datos tributarios ni datos migratorios.
export class CheckoutEventLog {
  constructor(
    readonly id: string,
    // null solo en un sobre no reconocible.
    readonly eventId: string | null,
    readonly eventType: string | null,
    readonly occurredAt: Date | null,
    readonly payload: CheckoutAuditPayload | null,
    readonly stayId: string | null,
    readonly status: CheckoutStatus,
    readonly errorCode: string | null,
    readonly reason: string | null,
    readonly resultNote: string | null,
    readonly processedAt: Date | null,
    readonly createdAt: Date,
  ) {}

  get isPending(): boolean {
    return this.status === 'PENDING';
  }
}
