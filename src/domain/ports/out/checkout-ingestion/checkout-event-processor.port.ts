// Feature 010 · Registrar Check-out
import { CheckoutEvent } from '../../../model/checkout-ingestion/checkout-event';

export const CHECKOUT_EVENT_PROCESSOR = Symbol('CheckoutEventProcessorPort');

export interface CheckoutProcessingResult {
  // Nota de auditoría para un PROCESSED sin factura; null si no aplica.
  resultNote: string | null;
}

// Paso de negocio de un evento válido: Generar liquidación (007) y después Generar
// factura final (006). Lo implementa CheckoutEventProcessorService (T010); separarlo
// permite probar RegisterCheckoutService con dobles de este puerto.
//
// Los errores se lanzan como DomainError con su errorCode. RegisterCheckoutService
// decide con ese código si el evento va a la cola de reintento o a la DLQ.
export interface CheckoutEventProcessorPort {
  process(event: CheckoutEvent): Promise<CheckoutProcessingResult>;
}
