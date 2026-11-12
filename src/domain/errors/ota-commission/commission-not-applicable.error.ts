// Feature 003 · Consultar porcentaje de comisión OTA
import { DomainError } from '../domain.error';

// Se consultó el canal directo, que no es una OTA y no tiene comisión (FR-006, NFR-004).
// Reutiliza INVALID_QUERY_PARAMS del plan base: no se agrega un errorCode nuevo (plan 003).
export class CommissionNotApplicableError extends DomainError {
  readonly errorCode = 'INVALID_QUERY_PARAMS';

  constructor() {
    super('El canal directo no es una OTA: no tiene porcentaje de comisión que consultar.');
  }
}
