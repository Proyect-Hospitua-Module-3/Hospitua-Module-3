// Feature 001 · Actualizar porcentaje de IVA
import { DomainError } from '../domain.error';

export class InvalidVatRateError extends DomainError {
  readonly errorCode = 'INVALID_VAT_RATE';

  constructor() {
    super(
      'El porcentaje de IVA debe ser un decimal entre 0 y 100, con a lo sumo 2 decimales, ' +
        'enviado como texto (por ejemplo "19.00").',
    );
  }
}
