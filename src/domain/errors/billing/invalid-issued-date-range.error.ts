// Feature 008 · Gestionar facturación
import { DomainError } from '../domain.error';

// Rango de fechas de emisión incompleto o invertido (FR-013, SC-007). Se rechaza antes de
// consultar la base de datos, así que nunca hay un resultado parcial. Mismo errorCode que el
// rango de estancia de 005, con un mensaje propio de las fechas de emisión.
export class InvalidIssuedDateRangeError extends DomainError {
  readonly errorCode = 'INVALID_DATE_RANGE';

  constructor(message: string) {
    super(message);
  }
}
