// Feature 001 · Actualizar porcentaje de IVA
import { DomainError } from '../domain.error';

// La lectura del porcentaje vigente falló de forma transitoria. Es reintentable.
export class VatRateUnavailableError extends DomainError {
  readonly errorCode = 'VAT_RATE_UNAVAILABLE';

  constructor(readonly cause?: unknown) {
    super('No se pudo leer el porcentaje de IVA vigente; la operación puede reintentarse.');
  }
}
