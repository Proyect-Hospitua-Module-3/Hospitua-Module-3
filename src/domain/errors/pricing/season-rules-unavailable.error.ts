// Feature 009 · Modificar precio tarifa según temporada
import { DomainError } from '../domain.error';

// Código interno del puerto GetEffectiveSeasonRulesUseCase (no es un errorCode HTTP):
// la lectura del snapshot falló. Reintentable; 005 lo traduce a 422 UNEXPECTED_ERROR.
export class SeasonRulesUnavailableError extends DomainError {
  readonly errorCode = 'SEASON_RULES_UNAVAILABLE';

  constructor(readonly cause?: unknown) {
    super('No se pudieron leer las reglas de temporada vigentes; la operación puede reintentarse.');
  }
}
