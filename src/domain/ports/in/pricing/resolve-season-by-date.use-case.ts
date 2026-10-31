// Feature 011 · Revisar temporada del año
// Contrato: features/011-.../2-technical/contracts/PORT-resolve-season-by-date.md

export const RESOLVE_SEASON_BY_DATE_USE_CASE = Symbol('ResolveSeasonByDateUseCase');

export interface ResolveSeasonByDateQuery {
  // YYYY-MM-DD, fecha civil del hotel (no se convierte por zona horaria).
  date: string;
  // Instante UTC que 005 captura una vez por operación y usa también con el puerto de 009.
  asOf: Date;
}

export interface SeasonClassification {
  date: string;
  seasonId: string;
  source: 'BASE' | 'EXCEPTION' | 'DEFAULT';
  // Entrada aplicada; null si se usó el default.
  entryId: string | null;
  // Año civil de la fecha y su revisión efectiva en asOf (0 si aún no hay ninguna).
  calendarYear: number;
  revision: number;
  calendarEffectiveAt: string | null;
  // Revisión dueña de la entrada aplicada (puede ser la del año anterior); null para DEFAULT.
  entryOwnerYear: number | null;
  entryOwnerRevision: number | null;
  entryOwnerEffectiveAt: string | null;
}

// Puerto interno para 005 (tarifa dinámica). Precedencia EXCEPTION > BASE > DEFAULT.
// Lanza InvalidCalendarRangeError si la fecha o asOf no son válidos,
// SeasonCalendarInconsistentError si el calendario es ambiguo o apunta a una temporada
// que no está en el catálogo, y SeasonCalendarUnavailableError si la lectura falla.
export interface ResolveSeasonByDateUseCase {
  resolve(query: ResolveSeasonByDateQuery): Promise<SeasonClassification>;
}
