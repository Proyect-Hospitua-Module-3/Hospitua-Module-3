// Feature 011 · Revisar temporada del año
import { DomainError } from '../domain.error';

// Dos períodos BASE comparten al menos un día, dentro de la misma revisión o con los
// de un año vecino. No se elige uno por su cuenta: se rechaza la publicación (BR-005).
export class OverlappingSeasonCalendarError extends DomainError {
  readonly errorCode = 'OVERLAPPING_SEASON_CALENDAR';

  constructor(detail: string) {
    super(`Los períodos BASE no pueden compartir fechas: ${detail}`);
  }
}
