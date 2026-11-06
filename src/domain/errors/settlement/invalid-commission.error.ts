// Feature 007 · Generar liquidación
import { DomainError } from '../domain.error';

// Porcentaje de comisión OTA negativo, mayor a 100 o que no es un número decimal con a lo
// sumo 2 decimales. No se reemplaza por una comisión estimada (casos límite de la spec).
export class InvalidCommissionError extends DomainError {
  readonly errorCode = 'INVALID_COMMISSION';

  constructor(reservationRef: string, otaId: string, raw: unknown) {
    super(
      `La reserva ${reservationRef} de la OTA '${otaId}' tiene un porcentaje de comisión inválido (${String(raw)}): debe estar entre 0 y 100, con a lo sumo 2 decimales.`,
    );
  }
}
