// Feature 002 · Consultar liquidación
import { DomainError } from '../domain.error';

// Falta o tiene formato inválido un parámetro obligatorio para quien consulta (contrato
// GET-settlements.md, «Errores»). Mismo código que usa el plan base para parámetros
// inválidos. El mensaje nunca lleva información financiera (FR-013).
export class InvalidSettlementQueryError extends DomainError {
  readonly errorCode = 'INVALID_QUERY_PARAMS';

  constructor(message: string) {
    super(message);
  }
}
