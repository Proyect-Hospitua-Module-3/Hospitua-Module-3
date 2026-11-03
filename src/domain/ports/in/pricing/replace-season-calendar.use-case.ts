// Feature 011 · Revisar temporada del año
// Contrato: features/011-.../2-technical/contracts/ADMIN-season-calendar.md (PUT)
import { SeasonCalendarView } from './review-season-calendar.use-case';

export const REPLACE_SEASON_CALENDAR_USE_CASE = Symbol('ReplaceSeasonCalendarUseCase');

// Los valores llegan como los envía el Administrador; los valida el dominio.
// `actorId` es el `sub` del JWT: quién publica (FR-008, NFR-004).
export interface ReplaceSeasonCalendarCommand {
  year: unknown;
  // undefined: sin control optimista. null o 0: se espera que el año aún no tenga revisión.
  expectedRevision?: unknown;
  // Lista completa de entradas propias del año; lo que no venga queda eliminado.
  entries: unknown;
  actorId: string;
}

// PUT /admin/season-calendar/{year}: publica una revisión completa y la activa de forma
// atómica. Devuelve el calendario efectivo con la revisión recién publicada.
export interface ReplaceSeasonCalendarUseCase {
  replace(command: ReplaceSeasonCalendarCommand): Promise<SeasonCalendarView>;
}
