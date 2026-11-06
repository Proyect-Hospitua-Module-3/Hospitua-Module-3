// Feature 007 · Generar liquidación
import { DomainError } from '../domain.error';

// Reserva de canal OTA sin porcentaje de comisión. Nunca se asume uno por defecto
// (FR-014, HU2 escenario 3).
export class MissingCommissionError extends DomainError {
  readonly errorCode = 'MISSING_COMMISSION';

  constructor(reservationRef: string, otaId: string) {
    super(
      `La reserva ${reservationRef} es de la OTA '${otaId}' pero Módulo 2 no informó el porcentaje de comisión.`,
    );
  }
}
