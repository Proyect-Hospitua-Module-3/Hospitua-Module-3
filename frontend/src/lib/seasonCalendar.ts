// Feature 011 · Revisar temporada del año
// Clasificación de la vista previa. La validación final y la publicación siguen en el backend.
import type {
  CalendarConflict,
  CalendarDefaultRange,
  CalendarEntry,
  CalendarEntryInput,
  CalendarQuery,
  CalendarSeason,
  CarriedInEntry,
  SeasonCalendar,
} from '../api/seasonCalendar';

export const CALENDAR_MONTHS = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
] as const;

const DATE_FORMAT = /^(\d{4})-(\d{2})-(\d{2})$/;
const UUID_FORMAT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isCalendarYear(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 9999;
}

function monthLength(year: number, month: number): number {
  if (month === 2) return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

export function isCalendarDate(value: string): boolean {
  const parts = DATE_FORMAT.exec(value);
  if (!parts) return false;
  const [year, month, day] = parts.slice(1).map(Number);
  return isCalendarYear(year) && month >= 1 && month <= 12 && day >= 1 && day <= monthLength(year, month);
}

function padYear(year: number): string { return String(year).padStart(4, '0'); }

export function calendarYearBounds(year: number): { from: string; to: string } {
  if (!isCalendarYear(year)) throw new RangeError('El año debe estar entre 1 y 9999.');
  return { from: `${padYear(year)}-01-01`, to: `${padYear(year)}-12-31` };
}

export function calendarMonthDays(year: number, month: number): string[] {
  if (!isCalendarYear(year) || !Number.isInteger(month) || month < 1 || month > 12) return [];
  return Array.from({ length: monthLength(year, month) }, (_, index) =>
    `${padYear(year)}-${String(month).padStart(2, '0')}-${String(index + 1).padStart(2, '0')}`,
  );
}

// Aritmética gregoriana: no convierte fechas civiles a la zona del navegador y
// conserva los años 1..99 (Date.UTC los interpretaría como 1901..1999).
export function calendarWeekday(date: string): number {
  if (!isCalendarDate(date)) throw new RangeError('La fecha no es válida.');
  const [year, month, day] = date.split('-').map(Number);
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yearOfEra = y - era * 400;
  const dayOfYear = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  const dayOfEra = yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  const epochDay = era * 146097 + dayOfEra - 719468;
  return ((epochDay + 3) % 7 + 7) % 7;
}

export function formatCalendarDate(date: string): string {
  if (!isCalendarDate(date)) return date;
  const [year, month, day] = date.split('-');
  return `${day} ${CALENDAR_MONTHS[Number(month) - 1].slice(0, 3).toLowerCase()} ${year}`;
}

export interface CalendarQueryInput {
  year: string;
  from: string;
  to: string;
  mode: 'current' | 'revision' | 'asOf';
  revision: string;
  // Valor de datetime-local expresado en hora de Colombia (UTC−05:00).
  asOf: string;
}

export interface CalendarQueryErrors {
  year?: string;
  from?: string;
  to?: string;
  revision?: string;
  asOf?: string;
}

export function parseCalendarQuery(input: CalendarQueryInput):
  | { ok: true; query: CalendarQuery }
  | { ok: false; errors: CalendarQueryErrors } {
  const errors: CalendarQueryErrors = {};
  const yearText = input.year.trim();
  const year = /^\d{1,4}$/.test(yearText) ? Number(yearText) : NaN;
  if (!isCalendarYear(year)) errors.year = 'Escribe un año entre 1 y 9999.';
  const query: CalendarQuery = { year };
  const from = input.from.trim();
  const to = input.to.trim();
  if (from || to) {
    if (!from) errors.from = 'Indica también la fecha de inicio.';
    else if (!isCalendarDate(from)) errors.from = 'Escribe una fecha de inicio válida.';
    else if (isCalendarYear(year) && Number(from.slice(0, 4)) !== year) errors.from = 'La fecha debe pertenecer al año consultado.';
    if (!to) errors.to = 'Indica también la fecha de fin.';
    else if (!isCalendarDate(to)) errors.to = 'Escribe una fecha de fin válida.';
    else if (isCalendarYear(year) && Number(to.slice(0, 4)) !== year) errors.to = 'La fecha debe pertenecer al año consultado.';
    if (!errors.from && !errors.to && from > to) errors.to = 'La fecha de fin no puede ser anterior al inicio.';
    query.from = from;
    query.to = to;
  }
  if (input.mode === 'revision') {
    if (!/^[1-9]\d{0,8}$/.test(input.revision.trim())) errors.revision = 'Escribe un número de revisión mayor o igual a 1.';
    else query.revision = Number(input.revision.trim());
  } else if (input.mode === 'asOf') {
    const value = input.asOf.trim();
    const match = /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/.exec(value);
    if (!match || !isCalendarDate(match[1])) {
      errors.asOf = 'Indica una fecha y hora válidas en hora de Colombia.';
    } else {
      const instant = new Date(`${value}-05:00`);
      if (Number.isNaN(instant.getTime()) || !/^\d{4}-/.test(instant.toISOString())) {
        errors.asOf = 'La fecha y hora están fuera del intervalo admitido.';
      } else query.asOf = instant.toISOString();
    }
  }
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, query };
}

export interface CalendarEntryErrors {
  seasonId?: string;
  kind?: string;
  startDate?: string;
  endDate?: string;
}

export interface CalendarIssue {
  code: 'INVALID_CALENDAR_RANGE' | CalendarConflict['code'];
  message: string;
  entryIndexes: number[];
  dates?: { from: string; to: string };
}

export function validateCalendarEntry(
  year: number,
  input: CalendarEntryInput,
  seasons: readonly CalendarSeason[],
): CalendarEntryErrors {
  const errors: CalendarEntryErrors = {};
  if (!seasons.some((season) => season.seasonId === input.seasonId)) {
    errors.seasonId = 'Selecciona una temporada vigente del catálogo.';
  }
  if (input.kind !== 'BASE' && input.kind !== 'EXCEPTION') errors.kind = 'Selecciona período base o excepción puntual.';
  if (!isCalendarDate(input.startDate)) errors.startDate = 'Indica una fecha de inicio válida.';
  else if (!isCalendarYear(year) || Number(input.startDate.slice(0, 4)) !== year) {
    errors.startDate = 'El inicio debe pertenecer al año que estás editando.';
  }
  if (!isCalendarDate(input.endDate)) errors.endDate = 'Indica una fecha de fin válida.';
  else if (isCalendarDate(input.startDate) && input.endDate < input.startDate) errors.endDate = 'El fin no puede ser anterior al inicio.';
  else if (input.kind === 'EXCEPTION' && input.endDate !== input.startDate) errors.endDate = 'Una excepción debe cubrir un solo día.';
  else if (input.kind === 'BASE' && Number(input.endDate.slice(0, 4)) > year + 1) errors.endDate = 'Un período base solo puede llegar hasta el año siguiente.';
  return errors;
}

function intersection(a: { startDate: string; endDate: string }, b: { startDate: string; endDate: string }) {
  const from = a.startDate > b.startDate ? a.startDate : b.startDate;
  const to = a.endDate < b.endDate ? a.endDate : b.endDate;
  return from <= to ? { from, to } : null;
}

// Comprueba el borrador contra el catálogo y las bases heredadas visibles. El backend
// comprueba además el año siguiente y las publicaciones concurrentes bajo bloqueo.
export function validateCalendarDraft(
  year: number,
  entries: readonly CalendarEntryInput[],
  carriedIn: readonly CarriedInEntry[],
  seasons: readonly CalendarSeason[],
): CalendarIssue[] {
  if (!isCalendarYear(year)) return [{ code: 'INVALID_CALENDAR_RANGE', message: 'El año debe estar entre 1 y 9999.', entryIndexes: [] }];
  const issues: CalendarIssue[] = [];
  const usable: number[] = [];
  const ids = new Map<string, number>();
  entries.forEach((entry, index) => {
    const errors = validateCalendarEntry(year, entry, seasons);
    if (errors.seasonId) issues.push({ code: 'UNKNOWN_SEASON_REFERENCE', message: `Entrada ${index + 1}: ${errors.seasonId}`, entryIndexes: [index] });
    const invalidFields = [errors.kind, errors.startDate, errors.endDate].filter(Boolean);
    if (invalidFields.length) issues.push({ code: 'INVALID_CALENDAR_RANGE', message: `Entrada ${index + 1}: ${invalidFields.join(' ')}`, entryIndexes: [index] });
    else usable.push(index);
    if (entry.entryId !== undefined) {
      const key = entry.entryId.toLowerCase();
      if (!UUID_FORMAT.test(entry.entryId)) {
        issues.push({ code: 'INVALID_CALENDAR_RANGE', message: `La identidad de la entrada ${index + 1} no es válida.`, entryIndexes: [index] });
      } else if (ids.has(key)) {
        issues.push({ code: 'INVALID_CALENDAR_RANGE', message: 'Una misma entrada no puede aparecer dos veces.', entryIndexes: [ids.get(key)!, index] });
      }
      ids.set(key, index);
    }
  });
  for (let position = 0; position < usable.length; position++) {
    const index = usable[position];
    const entry = entries[index];
    for (const otherIndex of usable.slice(position + 1)) {
      const other = entries[otherIndex];
      const shared = intersection(entry, other);
      if (!shared || entry.kind !== other.kind) continue;
      issues.push({
        code: entry.kind === 'BASE' ? 'OVERLAPPING_SEASON_CALENDAR' : 'DUPLICATE_SEASON_EXCEPTION',
        message: entry.kind === 'BASE'
          ? `Los períodos ${index + 1} y ${otherIndex + 1} se solapan del ${formatCalendarDate(shared.from)} al ${formatCalendarDate(shared.to)}.`
          : `Hay dos excepciones para el ${formatCalendarDate(shared.from)}.`,
        entryIndexes: [index, otherIndex], dates: shared,
      });
    }
    if (entry.kind !== 'BASE') continue;
    for (const previous of carriedIn) {
      if (previous.kind !== 'BASE') continue;
      const shared = intersection(entry, previous);
      if (shared) issues.push({ code: 'OVERLAPPING_SEASON_CALENDAR', message: `El período ${index + 1} se solapa con una asignación del año ${previous.ownerYear}, del ${formatCalendarDate(shared.from)} al ${formatCalendarDate(shared.to)}.`, entryIndexes: [index], dates: shared });
    }
  }
  return issues;
}

export function calendarEntriesToDraft(calendar: SeasonCalendar): CalendarEntryInput[] {
  return calendar.entries.map((entry) => ({ entryId: entry.entryId, seasonId: entry.season.seasonId, kind: entry.kind, startDate: entry.startDate, endDate: entry.endDate }));
}

export function draftCalendarEntries(entries: readonly CalendarEntryInput[], seasons: readonly CalendarSeason[]): CalendarEntry[] {
  return entries.map((entry, index) => ({
    entryId: entry.entryId ?? `draft-${index}`,
    kind: entry.kind, startDate: entry.startDate, endDate: entry.endDate,
    season: seasons.find((season) => season.seasonId === entry.seasonId) ?? { seasonId: entry.seasonId, name: null, color: null, adjustmentPercent: null },
  }));
}

export interface CalendarDay {
  date: string;
  source: 'BASE' | 'EXCEPTION' | 'DEFAULT' | 'CONFLICT';
  season: CalendarSeason | null;
  entry: CalendarEntry | null;
  inherited: boolean;
  conflicts: CalendarConflict[];
}

export function resolveCalendarDate(
  date: string,
  entries: readonly CalendarEntry[],
  carriedIn: readonly CarriedInEntry[],
  defaultSeason: CalendarSeason,
  conflicts: readonly CalendarConflict[] = [],
): CalendarDay {
  if (!isCalendarDate(date)) throw new RangeError('La fecha no es válida.');
  const covers = (entry: CalendarEntry) => entry.startDate <= date && entry.endDate >= date;
  const exceptions = entries.filter((entry) => entry.kind === 'EXCEPTION' && covers(entry));
  const bases = [...entries, ...carriedIn].filter((entry) => entry.kind === 'BASE' && covers(entry));
  const dateConflicts = conflicts.filter((conflict) => conflict.dates.from <= date && conflict.dates.to >= date);
  function addConflict(code: CalendarConflict['code'], affected: CalendarEntry[], message: string) {
    const entryIds = affected.map((entry) => entry.entryId);
    if (!dateConflicts.some((conflict) => conflict.code === code && entryIds.every((id) => conflict.entryIds.includes(id)))) {
      dateConflicts.push({ code, blocking: true, dates: { from: date, to: date }, entryIds, message });
    }
  }
  if (exceptions.length > 1) addConflict('DUPLICATE_SEASON_EXCEPTION', exceptions, 'Esta fecha tiene más de una excepción.');
  if (bases.length > 1) addConflict('OVERLAPPING_SEASON_CALENDAR', bases, 'Esta fecha pertenece a más de un período base.');
  for (const entry of [...exceptions, ...bases]) {
    if (entry.season.name === null || entry.season.color === null || entry.season.adjustmentPercent === null) {
      addConflict('UNKNOWN_SEASON_REFERENCE', [entry], 'La temporada asignada no está disponible en este catálogo.');
    }
  }
  const applied = exceptions[0] ?? bases[0] ?? null;
  if (!applied && (defaultSeason.name === null || defaultSeason.color === null || defaultSeason.adjustmentPercent === null)) {
    addConflict('UNKNOWN_SEASON_REFERENCE', [], 'La temporada predeterminada no está disponible.');
  }
  if (dateConflicts.length) return { date, source: 'CONFLICT', season: null, entry: null, inherited: false, conflicts: dateConflicts };
  return { date, source: applied?.kind ?? 'DEFAULT', season: applied?.season ?? defaultSeason, entry: applied, inherited: applied !== null && carriedIn.includes(applied as CarriedInEntry), conflicts: [] };
}

export function calendarDefaultRanges(
  year: number,
  entries: readonly CalendarEntry[],
  carriedIn: readonly CarriedInEntry[],
  defaultSeason: CalendarSeason,
): CalendarDefaultRange[] {
  const ranges: CalendarDefaultRange[] = [];
  let open: CalendarDefaultRange | null = null;
  for (const date of CALENDAR_MONTHS.flatMap((_, month) => calendarMonthDays(year, month + 1))) {
    if (resolveCalendarDate(date, entries, carriedIn, defaultSeason).source === 'DEFAULT') {
      if (open) open.to = date;
      else { open = { from: date, to: date, resolvedAs: 'DEFAULT' }; ranges.push(open); }
    } else open = null;
  }
  return ranges;
}
