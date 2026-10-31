// Feature 009 · Modificar precio tarifa según temporada
import { DomainError } from '../domain.error';

// La temporada no existe o ya fue retirada del catálogo.
export class SeasonNotFoundError extends DomainError {
  readonly errorCode = 'SEASON_NOT_FOUND';

  constructor(seasonId: string) {
    super(`No existe una temporada activa con id ${seasonId}.`);
  }
}
