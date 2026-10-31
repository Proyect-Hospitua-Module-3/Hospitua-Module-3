// Feature 011 · Revisar temporada del año
import { DomainError } from '../domain.error';

// `expectedRevision` no es la revisión activa: otro Administrador publicó entretanto.
export class SeasonCalendarConflictError extends DomainError {
  readonly errorCode = 'SEASON_CALENDAR_CONFLICT';

  constructor(year: number, activeRevision: number) {
    super(
      `El calendario ${year} cambió mientras lo editabas (revisión activa ${activeRevision}). ` +
        'Consulta la clasificación vigente y vuelve a intentarlo.',
    );
  }
}
