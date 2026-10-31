// Feature 009 · Modificar precio tarifa según temporada
import { DomainError } from '../domain.error';

// Nombre o color malformado, nombre vacío o cuerpo sin campos para cambiar.
export class InvalidSeasonError extends DomainError {
  readonly errorCode = 'INVALID_SEASON';

  constructor(message: string) {
    super(message);
  }
}
