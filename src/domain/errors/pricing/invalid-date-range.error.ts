// Feature 005 · Consultar tarifa dinámica
import { DomainError } from '../domain.error';

// La fecha de salida es igual o anterior a la de entrada (FR-008, FR-015). Se rechaza la
// consulta o la cotización completa, sin calcular ninguna noche.
export class InvalidDateRangeError extends DomainError {
  readonly errorCode = 'INVALID_DATE_RANGE';

  constructor() {
    super(
      'La fecha de salida (checkOutDate) debe ser posterior a la fecha de entrada (checkInDate).',
    );
  }
}
