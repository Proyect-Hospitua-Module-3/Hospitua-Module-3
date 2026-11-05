// Feature 005 · Consultar tarifa dinámica
import { DomainError } from '../domain.error';

// Parámetros de GET /pricing/dynamic-rate o cuerpo de POST /pricing/quotes que faltan,
// sobran o tienen formato inválido. Mismo código que usa el plan base para parámetros
// inválidos (contratos GET y POST de 005).
export class InvalidPricingRequestError extends DomainError {
  readonly errorCode = 'INVALID_QUERY_PARAMS';

  constructor(message: string) {
    super(message);
  }
}
