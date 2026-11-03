// Feature 011 · Revisar temporada del año
import { DomainError } from '../domain.error';

// Más de una excepción puntual para la misma fecha, aunque apunten a la misma temporada.
export class DuplicateSeasonExceptionError extends DomainError {
  readonly errorCode = 'DUPLICATE_SEASON_EXCEPTION';

  constructor(dates: string[]) {
    super(`Solo puede haber una excepción por fecha; se repiten: ${dates.join(', ')}.`);
  }
}
