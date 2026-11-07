// Feature 010 · Registrar Check-out
import {
  CheckoutEventLog,
  NewCheckoutEventLog,
} from '../../../model/checkout-ingestion/checkout-event-log';

export const CHECKOUT_EVENT_LOG_REPOSITORY = Symbol('CheckoutEventLogRepositoryPort');

// Auditoría `checkout_event_log`. Cualquier fallo de estas operaciones se trata como
// DATABASE_UNAVAILABLE (contrato, sección 4).
export interface CheckoutEventLogRepositoryPort {
  // Crea el registro PENDING por eventId o devuelve el existente, de forma atómica.
  registerIfAbsent(eventLog: NewCheckoutEventLog): Promise<CheckoutEventLog>;

  // Las transiciones solo cambian un registro PENDING y fijan processed_at. Sobre un
  // registro ya final no hacen nada (otra entrega del mismo evento ya lo cerró).
  markProcessed(eventId: string, resultNote?: string | null): Promise<void>;
  markRejected(eventId: string, errorCode: string, reason: string): Promise<void>;
  markDeadLetter(eventId: string, errorCode: string, reason: string): Promise<void>;

  // Sobre no reconocible: REJECTED con INVALID_CHECKOUT_EVENT, sin event_id ni payload.
  registerUnrecognizedEnvelopeRejection(reason: string): Promise<void>;
}
