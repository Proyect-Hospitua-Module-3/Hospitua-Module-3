// Feature 003 · Consultar porcentaje de comisión OTA
import { DomainError } from '../domain.error';

// El {otaId} de la ruta está vacío o solo tiene espacios. Mismo código que usa el plan base
// para parámetros inválidos.
export class InvalidOtaCommissionQueryError extends DomainError {
  readonly errorCode = 'INVALID_QUERY_PARAMS';

  constructor(message: string) {
    super(message);
  }
}
