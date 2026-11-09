// Feature 011 · Revisar temporada del año
// Contrato: ADMIN-season-calendar.md. Las fechas del calendario son civiles e inclusivas.
import { apiRequest } from './http';

export type CalendarEntryKind = 'BASE' | 'EXCEPTION';

export interface CalendarSeason {
  seasonId: string;
  name: string | null;
  color: string | null;
  adjustmentPercent: string | null;
}

export interface CalendarEntry {
  entryId: string;
  kind: CalendarEntryKind;
  startDate: string;
  endDate: string;
  season: CalendarSeason;
}

export interface CarriedInEntry extends CalendarEntry {
  ownerYear: number;
  ownerRevision: number;
}

export interface CalendarConflict {
  code: 'OVERLAPPING_SEASON_CALENDAR' | 'DUPLICATE_SEASON_EXCEPTION' | 'UNKNOWN_SEASON_REFERENCE';
  blocking: true;
  dates: { from: string; to: string };
  entryIds: string[];
  message: string;
}

export interface CalendarDefaultRange {
  from: string;
  to: string;
  resolvedAs: 'DEFAULT';
}

export interface SeasonCalendar {
  year: number;
  asOf: string;
  revision: number;
  effectiveAt: string | null;
  changedBy: string | null;
  changedAt: string | null;
  defaultSeason: CalendarSeason;
  entries: CalendarEntry[];
  carriedInEntries: CarriedInEntry[];
  unclassifiedRanges: CalendarDefaultRange[];
  conflicts: CalendarConflict[];
}

export interface CalendarEntryInput {
  entryId?: string;
  seasonId: string;
  kind: CalendarEntryKind;
  startDate: string;
  endDate: string;
}

export interface CalendarQuery {
  year: number;
  from?: string;
  to?: string;
  revision?: number;
  asOf?: string;
}

export function getSeasonCalendar(token: string, query: CalendarQuery): Promise<SeasonCalendar> {
  const params = new URLSearchParams({ year: String(query.year) });
  if (query.from !== undefined) params.set('from', query.from);
  if (query.to !== undefined) params.set('to', query.to);
  if (query.revision !== undefined) params.set('revision', String(query.revision));
  if (query.asOf !== undefined) params.set('asOf', query.asOf);
  return apiRequest<SeasonCalendar>(`/admin/season-calendar?${params.toString()}`, { token });
}

export function publishSeasonCalendar(
  token: string,
  year: number,
  entries: readonly CalendarEntryInput[],
  expectedRevision: number | null,
): Promise<SeasonCalendar> {
  // Lista blanca: ni los metadatos de la temporada ni los de auditoría se publican.
  const ownEntries = entries.map((entry) => ({
    ...(entry.entryId === undefined ? {} : { entryId: entry.entryId }),
    seasonId: entry.seasonId,
    kind: entry.kind,
    startDate: entry.startDate,
    endDate: entry.endDate,
  }));
  return apiRequest<SeasonCalendar>(`/admin/season-calendar/${year}`, {
    method: 'PUT',
    token,
    body: { expectedRevision, entries: ownEntries },
  });
}
