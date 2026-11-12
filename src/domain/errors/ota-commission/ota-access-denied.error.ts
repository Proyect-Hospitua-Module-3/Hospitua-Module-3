// Feature 003 · Consultar porcentaje de comisión OTA
import { DomainError } from '../domain.error';

// Una OTA consulta el historial de otra OTA (BR-003, FR-009). El mensaje es genérico y el
// mismo exista o no historial de la otra OTA, para no confirmar nada sobre ella (SC-006).
export class OtaAccessDeniedError extends DomainError {
  readonly errorCode = 'FORBIDDEN';

  constructor() {
    super('No tiene permiso para consultar la información de esta OTA.');
  }
}
