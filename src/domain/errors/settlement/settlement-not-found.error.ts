// Feature 002 · Consultar liquidación
import { DomainError } from '../domain.error';

// La OTA no tiene liquidaciones Final visibles en la reserva: no hay ninguna todavía, la
// reserva es del canal directo o es de otra OTA (FR-005, FR-006). El mensaje es el mismo
// en los tres casos para no revelar si la reserva existe ni de quién es.
export class SettlementNotFoundError extends DomainError {
  readonly errorCode = 'SETTLEMENT_NOT_FOUND';

  constructor() {
    super(
      'No hay liquidaciones disponibles para esta reserva. Solo aparecen las habitaciones de tus reservas que ya tuvieron check-out.',
    );
  }
}
