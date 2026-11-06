// Feature 005 · Consultar tarifa dinámica
import { DomainError } from '../domain.error';

// La OTA consulta una habitación que no pertenece a una reserva intermediada por ella:
// reserva de otra OTA, del canal directo, inexistente o sin esa habitación (HU4, FR-010).
// El mensaje es el mismo en todos los casos, para no revelar si la reserva existe.
export class DynamicRateAccessDeniedError extends DomainError {
  readonly errorCode = 'FORBIDDEN';

  constructor() {
    super('No tienes permiso para consultar la tarifa de esta habitación.');
  }
}
