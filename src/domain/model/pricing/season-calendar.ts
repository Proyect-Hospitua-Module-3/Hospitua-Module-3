// Feature 011 · Revisar temporada del año
import { DuplicateSeasonExceptionError } from '../../errors/pricing/duplicate-season-exception.error';
import { InvalidCalendarRangeError } from '../../errors/pricing/invalid-calendar-range.error';
import { OverlappingSeasonCalendarError } from '../../errors/pricing/overlapping-season-calendar.error';
import { SeasonCalendarConflictError } from '../../errors/pricing/season-calendar-conflict.error';
import { SeasonCalendarInconsistentError } from '../../errors/pricing/season-calendar-inconsistent.error';
import { UnknownSeasonReferenceError } from '../../errors/pricing/unknown-season-reference.error';
import { CalendarDateRange } from './calendar-date-range.vo';
import { CalendarDate } from './calendar-date.vo';
import { CalendarYear } from './calendar-year.vo';
import { RawCalendarEntry, SeasonCalendarEntry } from './season-calendar-entry';

// ---------------------------------------------------------------------------
// Revisión publicada
// ---------------------------------------------------------------------------

// Revisión anual del calendario: inmutable una vez publicada. La vigencia
// (`effectiveAt`) es de la revisión completa, no de cada entrada (plan 011).
export class SeasonCalendarRevision {
  constructor(
    readonly year: number,
    readonly revision: number,
    readonly effectiveAt: Date,
    readonly changedBy: string,
    readonly changedAt: Date,
    readonly entries: readonly SeasonCalendarEntry[],
  ) {}

  // Períodos BASE de esta revisión que se prolongan hasta `year` (BR-006). Se usa con
  // la revisión del año anterior para obtener las entradas heredadas.
  basesReaching(year: number): SeasonCalendarEntry[] {
    const firstDay = CalendarDate.fromParts(year, 1, 1);
    return this.entries.filter((e) => e.isBase && !e.range.end.isBefore(firstDay));
  }
}

// Entrada junto con la revisión a la que pertenece (propia del año o heredada).
export interface OwnedEntry {
  entry: SeasonCalendarEntry;
  owner: SeasonCalendarRevision;
}

// ---------------------------------------------------------------------------
// Publicación (PUT /admin/season-calendar/{year})
// ---------------------------------------------------------------------------

// Período BASE de la revisión activa de un año vecino (N-1 o N+1) al publicar N.
export interface NeighborBase {
  entry: SeasonCalendarEntry;
  ownerYear: number;
  ownerRevision: number;
}

// Estado leído con los bloqueos ya tomados, que la publicación necesita para decidir.
export interface PublicationContext {
  // Revisión activa del año que se publica; 0 si todavía no hay ninguna.
  activeRevision: number;
  // De los `seasonId` referenciados, los que existen en el catálogo y no están retirados.
  activeSeasonIds: ReadonlySet<string>;
  neighborBases: readonly NeighborBase[];
}

// Clasificación completa de un año que el Administrador quiere publicar. Reemplaza a
// la revisión vigente: lo que no venga aquí queda eliminado en la nueva revisión.
export class SeasonCalendarDraft {
  private constructor(
    readonly year: CalendarYear,
    // undefined: sin control optimista. null o 0: se espera que el año aún no tenga revisión.
    readonly expectedRevision: number | null | undefined,
    readonly entries: readonly SeasonCalendarEntry[],
  ) {}

  // Valida la forma completa antes de tocar la base de datos (400 INVALID_CALENDAR_RANGE).
  static parse(
    input: { year: unknown; expectedRevision?: unknown; entries: unknown },
    newEntryId: () => string,
  ): SeasonCalendarDraft {
    const year = CalendarYear.of(input.year);
    const expectedRevision = parseExpectedRevision(input.expectedRevision);
    if (!Array.isArray(input.entries)) {
      throw new InvalidCalendarRangeError('entries debe ser una lista (puede estar vacía).');
    }
    const entries = input.entries.map((raw: unknown, position) => {
      if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
        throw new InvalidCalendarRangeError(`entries[${position}] debe ser un objeto.`);
      }
      return SeasonCalendarEntry.forPublication(
        raw as RawCalendarEntry,
        year,
        position,
        newEntryId,
      );
    });

    const seen = new Set<string>();
    for (const entry of entries) {
      if (seen.has(entry.entryId)) {
        throw new InvalidCalendarRangeError(`El entryId ${entry.entryId} está repetido.`);
      }
      seen.add(entry.entryId);
    }
    return new SeasonCalendarDraft(year, expectedRevision, entries);
  }

  // `seasonId` distintos que referencia la revisión, en orden estable.
  referencedSeasonIds(): string[] {
    return [...new Set(this.entries.map((e) => e.seasonId))].sort();
  }

  // Decide si se puede publicar, con el estado leído bajo bloqueo. Orden del contrato:
  // control optimista → referencias al catálogo → excepciones duplicadas → solapes BASE.
  assertPublishable(context: PublicationContext): void {
    if (
      this.expectedRevision !== undefined &&
      (this.expectedRevision ?? 0) !== context.activeRevision
    ) {
      throw new SeasonCalendarConflictError(this.year.value, context.activeRevision);
    }

    const unknown = this.referencedSeasonIds().filter((id) => !context.activeSeasonIds.has(id));
    if (unknown.length > 0) {
      throw new UnknownSeasonReferenceError(unknown);
    }

    const exceptionDates = new Map<string, number>();
    for (const entry of this.entries.filter((e) => e.isException)) {
      const date = entry.range.start.toString();
      exceptionDates.set(date, (exceptionDates.get(date) ?? 0) + 1);
    }
    const repeated = [...exceptionDates].filter(([, count]) => count > 1).map(([date]) => date);
    if (repeated.length > 0) {
      throw new DuplicateSeasonExceptionError(repeated.sort());
    }

    const overlaps: string[] = [];
    const bases = this.entries.filter((e) => e.isBase);
    for (let i = 0; i < bases.length; i++) {
      for (let j = i + 1; j < bases.length; j++) {
        const shared = bases[i].range.intersection(bases[j].range);
        if (shared) {
          overlaps.push(
            `${describe(bases[i])} y ${describe(bases[j])} comparten ${shared.toString()}`,
          );
        }
      }
      for (const neighbor of context.neighborBases) {
        const shared = bases[i].range.intersection(neighbor.entry.range);
        if (shared) {
          overlaps.push(
            `${describe(bases[i])} y el período ${neighbor.entry.range.toString()} del calendario ` +
              `${neighbor.ownerYear} (revisión ${neighbor.ownerRevision}) comparten ${shared.toString()}`,
          );
        }
      }
    }
    if (overlaps.length > 0) {
      throw new OverlappingSeasonCalendarError(`${overlaps.join('; ')}.`);
    }
  }
}

function parseExpectedRevision(raw: unknown): number | null | undefined {
  if (raw === undefined || raw === null) {
    return raw;
  }
  if (typeof raw === 'number' && Number.isInteger(raw) && raw >= 0) {
    return raw;
  }
  throw new InvalidCalendarRangeError(
    'expectedRevision debe ser un entero mayor o igual a 0, o null si el año aún no tiene revisión.',
  );
}

function describe(entry: SeasonCalendarEntry): string {
  return `el período ${entry.range.toString()} (${entry.entryId})`;
}

// ---------------------------------------------------------------------------
// Clasificación de fechas (lectura administrativa y puerto de 005)
// ---------------------------------------------------------------------------

export type ClassificationSource = 'BASE' | 'EXCEPTION' | 'DEFAULT';

// Lo mínimo que la clasificación necesita del catálogo de 009 en el mismo instante.
export interface SeasonCatalogLookup {
  defaultSeasonId: string;
  has(seasonId: string): boolean;
}

export interface ResolvedSeason {
  date: CalendarDate;
  seasonId: string;
  source: ClassificationSource;
  // null cuando se aplica el default.
  applied: OwnedEntry | null;
}

export type CalendarConflictCode =
  | 'OVERLAPPING_SEASON_CALENDAR'
  | 'DUPLICATE_SEASON_EXCEPTION'
  | 'UNKNOWN_SEASON_REFERENCE';

// Inconsistencia encontrada al revisar datos ya guardados. Siempre bloquea el cálculo
// de tarifa (`blocking: true` en la respuesta).
export interface CalendarConflict {
  code: CalendarConflictCode;
  dates: CalendarDateRange;
  entryIds: string[];
  message: string;
}

export interface CalendarInspection {
  // Fechas sin EXCEPTION ni BASE (propia o heredada): se resuelven al default.
  unclassified: CalendarDateRange[];
  conflicts: CalendarConflict[];
}

// Calendario de un año tal como se ve en un instante: su revisión efectiva (si existe)
// y la del año anterior, de la que se heredan los BASE que cruzan el 31 de diciembre.
export class YearCalendar {
  readonly year: CalendarYear;

  constructor(
    year: CalendarYear,
    readonly own: SeasonCalendarRevision | null,
    readonly previous: SeasonCalendarRevision | null,
  ) {
    if (own && own.year !== year.value) {
      throw new Error(`La revisión propia es de ${own.year}, no de ${year.value}.`);
    }
    if (previous && previous.year !== year.value - 1) {
      throw new Error(`La revisión anterior es de ${previous.year}, no de ${year.value - 1}.`);
    }
    this.year = year;
  }

  ownEntries(): OwnedEntry[] {
    return this.own ? this.own.entries.map((entry) => ({ entry, owner: this.own! })) : [];
  }

  carriedIn(): OwnedEntry[] {
    return this.previous
      ? this.previous
          .basesReaching(this.year.value)
          .map((entry) => ({ entry, owner: this.previous! }))
      : [];
  }

  // Entradas que cubren una fecha del año. Las EXCEPTION solo pueden ser del propio año.
  matching(date: CalendarDate): { exceptions: OwnedEntry[]; bases: OwnedEntry[] } {
    const own = this.ownEntries().filter((o) => o.entry.covers(date));
    return {
      exceptions: own.filter((o) => o.entry.isException),
      bases: [
        ...own.filter((o) => o.entry.isBase),
        ...this.carriedIn().filter((o) => o.entry.covers(date)),
      ],
    };
  }

  // Precedencia EXCEPTION > BASE > DEFAULT (contrato PORT-resolve-season-by-date). Si los
  // datos de esa fecha son ambiguos o apuntan a una temporada que no está en el catálogo,
  // falla: nunca elige por orden ni cae al default.
  resolve(date: CalendarDate, catalog: SeasonCatalogLookup): ResolvedSeason {
    if (!this.year.contains(date)) {
      throw new Error(`La fecha ${date.toString()} no pertenece al año ${this.year.value}.`);
    }
    const { exceptions, bases } = this.matching(date);
    if (exceptions.length > 1) {
      throw new SeasonCalendarInconsistentError(
        `hay ${exceptions.length} excepciones para ${date.toString()} (${ids(exceptions).join(', ')}).`,
      );
    }
    if (bases.length > 1) {
      throw new SeasonCalendarInconsistentError(
        `${bases.length} períodos BASE cubren ${date.toString()} (${ids(bases).join(', ')}).`,
      );
    }

    const applied = exceptions[0] ?? bases[0] ?? null;
    const seasonId = applied ? applied.entry.seasonId : catalog.defaultSeasonId;
    if (!catalog.has(seasonId)) {
      throw new SeasonCalendarInconsistentError(
        `la temporada ${seasonId} asignada a ${date.toString()} no está en el catálogo de temporadas.`,
      );
    }
    return { date, seasonId, source: applied ? applied.entry.kind : 'DEFAULT', applied };
  }

  // Revisión administrativa de una ventana del año: fechas que caen al default y
  // conflictos, sin lanzar errores para que el Administrador vea todo (contrato GET).
  inspect(window: CalendarDateRange, catalog: SeasonCatalogLookup): CalendarInspection {
    const unclassified: CalendarDateRange[] = [];
    const conflicts: CalendarConflict[] = [];
    let openUnclassified: CalendarDate | null = null;
    let previousDay: CalendarDate | null = null;
    // Conflicto en curso por fecha: se extiende mientras se repite el mismo código y entradas.
    let openConflicts = new Map<
      string,
      { code: CalendarConflictCode; ids: string[]; from: CalendarDate }
    >();
    const closeConflict = (key: string, until: CalendarDate) => {
      const open = openConflicts.get(key)!;
      conflicts.push(dateConflict(open.code, CalendarDateRange.of(open.from, until), open.ids));
    };

    for (const day of window.days()) {
      const { exceptions, bases } = this.matching(day);

      if (exceptions.length === 0 && bases.length === 0) {
        openUnclassified ??= day;
      } else if (openUnclassified) {
        unclassified.push(CalendarDateRange.of(openUnclassified, previousDay!));
        openUnclassified = null;
      }

      const today = new Map<string, { code: CalendarConflictCode; ids: string[] }>();
      if (exceptions.length > 1) {
        const entryIds = ids(exceptions).sort();
        today.set(`DUPLICATE|${entryIds.join(',')}`, {
          code: 'DUPLICATE_SEASON_EXCEPTION',
          ids: entryIds,
        });
      }
      if (bases.length > 1) {
        const entryIds = ids(bases).sort();
        today.set(`OVERLAP|${entryIds.join(',')}`, {
          code: 'OVERLAPPING_SEASON_CALENDAR',
          ids: entryIds,
        });
      }
      for (const key of openConflicts.keys()) {
        if (!today.has(key)) {
          closeConflict(key, previousDay!);
        }
      }
      const stillOpen = new Map<
        string,
        { code: CalendarConflictCode; ids: string[]; from: CalendarDate }
      >();
      for (const [key, value] of today) {
        stillOpen.set(key, openConflicts.get(key) ?? { ...value, from: day });
      }
      openConflicts = stillOpen;
      previousDay = day;
    }
    if (openUnclassified) {
      unclassified.push(CalendarDateRange.of(openUnclassified, window.end));
    }
    for (const key of openConflicts.keys()) {
      closeConflict(key, window.end);
    }

    for (const { entry } of [...this.ownEntries(), ...this.carriedIn()]) {
      const shared = entry.range.intersection(window);
      if (shared && !catalog.has(entry.seasonId)) {
        conflicts.push({
          code: 'UNKNOWN_SEASON_REFERENCE',
          dates: shared,
          entryIds: [entry.entryId],
          message: `La entrada ${entry.entryId} apunta a la temporada ${entry.seasonId}, que no está en el catálogo.`,
        });
      }
    }

    conflicts.sort(
      (a, b) => a.dates.start.epochDay - b.dates.start.epochDay || a.code.localeCompare(b.code),
    );
    return { unclassified, conflicts };
  }
}

function ids(owned: OwnedEntry[]): string[] {
  return owned.map((o) => o.entry.entryId);
}

function dateConflict(
  code: CalendarConflictCode,
  dates: CalendarDateRange,
  entryIds: string[],
): CalendarConflict {
  const message =
    code === 'DUPLICATE_SEASON_EXCEPTION'
      ? `Hay más de una excepción para ${dates.toString()}; corrígelo antes de usar estas fechas.`
      : `Hay más de un período BASE para ${dates.toString()}; corrígelo antes de usar estas fechas.`;
  return { code, dates, entryIds, message };
}
