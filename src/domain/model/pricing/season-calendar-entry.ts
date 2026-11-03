// Feature 011 · Revisar temporada del año
import { InvalidCalendarRangeError } from '../../errors/pricing/invalid-calendar-range.error';
import { CalendarDateRange } from './calendar-date-range.vo';
import { CalendarDate } from './calendar-date.vo';
import { CalendarYear } from './calendar-year.vo';

export const CALENDAR_ENTRY_KINDS = ['BASE', 'EXCEPTION'] as const;
export type CalendarEntryKind = (typeof CALENDAR_ENTRY_KINDS)[number];

const UUID_FORMAT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Entrada tal como la envía el Administrador en el PUT; la valida `forPublication`.
export interface RawCalendarEntry {
  entryId?: unknown;
  seasonId?: unknown;
  kind?: unknown;
  startDate?: unknown;
  endDate?: unknown;
}

// Período BASE o excepción puntual de una revisión del calendario. No tiene vigencia
// propia: la vigencia es de la revisión que la contiene. Solo guarda el `seasonId`;
// nombre, color y ajuste son del catálogo de 009 (plan 011).
export class SeasonCalendarEntry {
  constructor(
    // Identidad estable de la entrada: se conserva entre revisiones si el cliente la reenvía.
    readonly entryId: string,
    readonly seasonId: string,
    readonly kind: CalendarEntryKind,
    readonly range: CalendarDateRange,
  ) {}

  // Valida una entrada para publicarla en `ownerYear` (contrato ADMIN-season-calendar, PUT):
  //   - BASE: empieza en el año propietario y termina como máximo el año siguiente (BR-006).
  //   - EXCEPTION: un solo día, dentro del año propietario.
  // Que la temporada exista en el catálogo se revisa después, con el catálogo bloqueado.
  static forPublication(
    raw: RawCalendarEntry,
    ownerYear: CalendarYear,
    position: number,
    newEntryId: () => string,
  ): SeasonCalendarEntry {
    const label = `entries[${position}]`;
    const kind = raw.kind;
    if (!CALENDAR_ENTRY_KINDS.includes(kind as CalendarEntryKind)) {
      throw new InvalidCalendarRangeError(`${label}.kind debe ser BASE o EXCEPTION.`);
    }
    if (typeof raw.seasonId !== 'string' || raw.seasonId.trim() === '') {
      throw new InvalidCalendarRangeError(`${label}.seasonId es obligatorio.`);
    }
    let entryId: string;
    if (raw.entryId === undefined || raw.entryId === null) {
      entryId = newEntryId();
    } else if (typeof raw.entryId === 'string' && UUID_FORMAT.test(raw.entryId)) {
      entryId = raw.entryId.toLowerCase();
    } else {
      throw new InvalidCalendarRangeError(`${label}.entryId debe ser un UUID.`);
    }

    const start = CalendarDate.of(raw.startDate, `${label}.startDate`);
    const end = CalendarDate.of(raw.endDate, `${label}.endDate`);
    const range = CalendarDateRange.of(start, end, `${label}`);
    if (!ownerYear.contains(start)) {
      throw new InvalidCalendarRangeError(
        `${label} empieza el ${start.toString()}, fuera del año ${ownerYear.value} que se publica.`,
      );
    }
    if (kind === 'BASE' && end.isAfter(ownerYear.lastDayOfNextYear())) {
      throw new InvalidCalendarRangeError(
        `${label} es un período BASE de ${ownerYear.value} y solo puede llegar hasta ` +
          `${ownerYear.lastDayOfNextYear().toString()}.`,
      );
    }
    if (kind === 'EXCEPTION' && !start.equals(end)) {
      throw new InvalidCalendarRangeError(
        `${label} es una EXCEPTION y debe cubrir un solo día (startDate = endDate).`,
      );
    }

    // Un id que no es UUID no puede existir en el catálogo: se conserva tal cual y se
    // rechaza después como referencia desconocida (UNKNOWN_SEASON_REFERENCE).
    const seasonId = UUID_FORMAT.test(raw.seasonId) ? raw.seasonId.toLowerCase() : raw.seasonId;
    return new SeasonCalendarEntry(entryId, seasonId, kind as CalendarEntryKind, range);
  }

  covers(date: CalendarDate): boolean {
    return this.range.contains(date);
  }

  get isBase(): boolean {
    return this.kind === 'BASE';
  }

  get isException(): boolean {
    return this.kind === 'EXCEPTION';
  }
}

export function isUuid(value: string): boolean {
  return UUID_FORMAT.test(value);
}
