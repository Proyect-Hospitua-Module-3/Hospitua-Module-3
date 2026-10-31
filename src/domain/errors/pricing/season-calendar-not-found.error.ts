// Feature 011 · Revisar temporada del año
import { DomainError } from '../domain.error';

// Se pidió una revisión histórica concreta que no existe para ese año.
export class SeasonCalendarNotFoundError extends DomainError {
  readonly errorCode = 'SEASON_CALENDAR_NOT_FOUND';

  constructor(year: number, revision: number) {
    super(`No existe la revisión ${revision} del calendario ${year}.`);
  }
}
