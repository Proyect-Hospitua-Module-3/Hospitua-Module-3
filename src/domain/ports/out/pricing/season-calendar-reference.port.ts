// Feature 009 · Modificar precio tarifa según temporada
export const SEASON_CALENDAR_REFERENCE = Symbol('SeasonCalendarReferencePort');

// Consulta de solo lectura al calendario de 011: ¿alguna revisión ACTIVA (de cualquier
// año) asigna esta temporada en un período o excepción? Las revisiones históricas no
// cuentan. 009 la usa para no retirar una temporada en uso (SEASON_IN_USE).
export interface SeasonCalendarReferencePort {
  isReferencedByActiveRevision(seasonId: string): Promise<boolean>;
}
