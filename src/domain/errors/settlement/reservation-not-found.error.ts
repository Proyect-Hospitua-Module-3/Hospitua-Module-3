// Feature 007 · Generar liquidación
import { DomainError } from '../domain.error';

// Módulo 2 respondió 404 para la reserva del check-out (FR-014). No es reintentable.
export class ReservationNotFoundError extends DomainError {
  readonly errorCode = 'RESERVATION_NOT_FOUND';

  constructor(readonly reservationRef: string) {
    super(
      `Módulo 2 no tiene la reserva ${reservationRef}. Verifica el código de reserva del check-out.`,
    );
  }
}
