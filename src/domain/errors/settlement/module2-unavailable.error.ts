// Feature 007 · Generar liquidación
import { DomainError } from '../domain.error';

// Timeout, 5xx, fallo de red, circuito abierto o respuesta que no cumple el contrato al
// consultar la reserva (FR-021). Reintentable: nunca se liquida con datos supuestos.
export class Module2UnavailableError extends DomainError {
  readonly errorCode = 'MODULE2_UNAVAILABLE';

  constructor(
    readonly reservationRef: string,
    readonly cause?: unknown,
  ) {
    super(
      `Módulo 2 no respondió al consultar la reserva ${reservationRef}. Se puede reintentar cuando Módulo 2 vuelva a responder.`,
    );
  }
}
