// Feature 004 · Consultar tarifa base
import { DomainError } from '../domain.error';

export class InvalidBaseRateQueryError extends DomainError {
  readonly errorCode = 'INVALID_QUERY_PARAMS';

  constructor() {
    super('El roomId debe ser un UUID y la fecha debe tener formato YYYY-MM-DD válido.');
  }
}
