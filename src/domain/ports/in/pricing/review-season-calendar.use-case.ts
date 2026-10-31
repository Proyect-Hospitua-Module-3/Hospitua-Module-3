// Feature 011 · Revisar temporada del año
// Contrato: features/011-.../2-technical/contracts/ADMIN-season-calendar.md (GET)

export const REVIEW_SEASON_CALENDAR_USE_CASE = Symbol('ReviewSeasonCalendarUseCase');

// Los valores llegan como los envía el Administrador (texto de la query); los validan
// los value objects. `from`/`to` van juntos o se omiten; `asOf` y `revision` se excluyen.
export interface ReviewSeasonCalendarQuery {
  year: unknown;
  from?: unknown;
  to?: unknown;
  asOf?: unknown;
  revision?: unknown;
}

// Datos de la temporada tomados del catálogo de 009 en el mismo instante. Si una entrada
// apunta a una temporada que no está en el catálogo, nombre, color y ajuste son null y
// la respuesta incluye un conflicto UNKNOWN_SEASON_REFERENCE.
export interface CalendarSeasonView {
  seasonId: string;
  name: string | null;
  color: string | null;
  adjustmentPercent: string | null;
}

export interface CalendarEntryView {
  entryId: string;
  kind: 'BASE' | 'EXCEPTION';
  startDate: string;
  endDate: string;
  season: CalendarSeasonView;
}

// Período BASE de la revisión del año anterior que se prolonga al año consultado.
export interface CarriedInEntryView extends CalendarEntryView {
  ownerYear: number;
  ownerRevision: number;
}

export interface UnclassifiedRangeView {
  from: string;
  to: string;
  resolvedAs: 'DEFAULT';
}

export interface CalendarConflictView {
  code: 'OVERLAPPING_SEASON_CALENDAR' | 'DUPLICATE_SEASON_EXCEPTION' | 'UNKNOWN_SEASON_REFERENCE';
  blocking: true;
  dates: { from: string; to: string };
  entryIds: string[];
  message: string;
}

export interface SeasonCalendarView {
  year: number;
  // Instante de referencia de la lectura (la hora de la base de datos si no se pidió otro).
  asOf: Date;
  // 0 si el año aún no tiene una revisión publicada.
  revision: number;
  effectiveAt: Date | null;
  changedBy: string | null;
  changedAt: Date | null;
  defaultSeason: CalendarSeasonView;
  entries: CalendarEntryView[];
  carriedInEntries: CarriedInEntryView[];
  unclassifiedRanges: UnclassifiedRangeView[];
  conflicts: CalendarConflictView[];
}

// GET /admin/season-calendar: clasificación del año, huecos, excepciones y conflictos.
export interface ReviewSeasonCalendarUseCase {
  review(query: ReviewSeasonCalendarQuery): Promise<SeasonCalendarView>;
}
