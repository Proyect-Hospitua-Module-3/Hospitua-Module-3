// Feature 011 · Revisar temporada del año
import { DomainError } from '../domain.error';

// Código interno del puerto ResolveSeasonByDateUseCase (no es un errorCode HTTP): no se
// pudo leer el calendario o el catálogo. Reintentable; 005 lo traduce a 422 UNEXPECTED_ERROR.
export class SeasonCalendarUnavailableError extends DomainError {
  readonly errorCode = 'SEASON_CALENDAR_UNAVAILABLE';

  constructor(readonly cause?: unknown) {
    super('No se pudo leer el calendario de temporadas; la operación puede reintentarse.');
  }
}
