// Feature 004 · Consultar tarifa base
import { DomainError } from '../domain.error';

export class InvalidBaseRateError extends DomainError {
  readonly errorCode = 'INVALID_BASE_RATE';

  constructor() {
    super('La tarifa base debe ser un importe decimal estrictamente positivo.');
  }
}
