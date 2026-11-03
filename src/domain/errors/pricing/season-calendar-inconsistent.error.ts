// Feature 011 · Revisar temporada del año
import { DomainError } from '../domain.error';

// Código interno del puerto ResolveSeasonByDateUseCase (no es un errorCode HTTP): el
// calendario o su relación con el catálogo de 009 está corrupto para la fecha pedida
// (dos excepciones, dos BASE, o una temporada que falta del catálogo). No se usa el
// default como respaldo. No es reintentable; 005 lo traduce a 422 UNEXPECTED_ERROR.
export class SeasonCalendarInconsistentError extends DomainError {
  readonly errorCode = 'SEASON_CALENDAR_INCONSISTENT';

  constructor(detail: string) {
    super(`El calendario de temporadas es inconsistente: ${detail}`);
  }
}
