// Feature 007 · Generar liquidación
import { DomainError } from '../domain.error';

// Ninguna cotización de la reserva corresponde a la habitación del check-out (FR-014, FR-020).
export class QuoteNotFoundError extends DomainError {
  readonly errorCode = 'QUOTE_NOT_FOUND';

  constructor(reservationRef: string, roomId: string) {
    super(
      `La reserva ${reservationRef} no tiene una cotización de hospedaje para la habitación ${roomId}. Revisa en Módulo 2 las cotizaciones de la reserva.`,
    );
  }
}
