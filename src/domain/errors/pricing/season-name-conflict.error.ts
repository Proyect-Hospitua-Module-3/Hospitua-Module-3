// Feature 009 · Modificar precio tarifa según temporada
import { DomainError } from '../domain.error';

export class SeasonNameConflictError extends DomainError {
  readonly errorCode = 'SEASON_NAME_CONFLICT';

  constructor(name: string) {
    super(`Ya existe una temporada activa llamada "${name}" (sin distinguir mayúsculas).`);
  }
}
