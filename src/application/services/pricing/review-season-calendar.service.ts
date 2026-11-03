// Feature 011 · Revisar temporada del año
import { InvalidCalendarRangeError } from '../../../domain/errors/pricing/invalid-calendar-range.error';
import { SeasonCalendarNotFoundError } from '../../../domain/errors/pricing/season-calendar-not-found.error';
import { CalendarDateRange } from '../../../domain/model/pricing/calendar-date-range.vo';
import { CalendarDate } from '../../../domain/model/pricing/calendar-date.vo';
import { CalendarYear } from '../../../domain/model/pricing/calendar-year.vo';
import {
  OwnedEntry,
  SeasonCalendarRevision,
  YearCalendar,
} from '../../../domain/model/pricing/season-calendar';
import {
  CalendarEntryView,
  CalendarSeasonView,
  ReviewSeasonCalendarQuery,
  ReviewSeasonCalendarUseCase,
  SeasonCalendarView,
} from '../../../domain/ports/in/pricing/review-season-calendar.use-case';
import { SeasonCalendarRepositoryPort } from '../../../domain/ports/out/pricing/season-calendar.repository.port';
import { SeasonCatalogQueryPort } from '../../../domain/ports/out/pricing/season-catalog-query.port';
import { IndexedSeasonCatalog, indexSeasonCatalog } from './season-catalog-lookup';

// Instante ISO 8601 con zona horaria explícita (Z u offset): sin zona sería ambiguo.
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/;
const POSITIVE_INTEGER = /^[1-9]\d{0,8}$/;

// Sin decoradores de NestJS: la capa de aplicación solo depende del dominio.
// El wiring con sus adaptadores está en infrastructure/config/pricing.module.ts.
export class ReviewSeasonCalendarService implements ReviewSeasonCalendarUseCase {
  constructor(
    private readonly calendars: SeasonCalendarRepositoryPort,
    private readonly catalog: SeasonCatalogQueryPort,
  ) {}

  async review(query: ReviewSeasonCalendarQuery): Promise<SeasonCalendarView> {
    // Todo se valida antes de leer: un rango inválido no devuelve nada parcial (FR-007).
    const year = CalendarYear.of(query.year);
    const window = parseWindow(query.from, query.to, year);
    if (query.asOf !== undefined && query.revision !== undefined) {
      throw new InvalidCalendarRangeError('asOf y revision no se pueden enviar a la vez.');
    }
    const asOf = query.asOf === undefined ? null : parseInstant(query.asOf);
    const revisionNumber = query.revision === undefined ? null : parseRevision(query.revision);

    let own: SeasonCalendarRevision | null;
    let previous: SeasonCalendarRevision | null;
    let reference: Date;
    if (revisionNumber !== null) {
      // Revisión histórica explícita: su propia vigencia es el instante de referencia
      // para cargar la del año anterior y el catálogo (regla 3 del GET).
      own = await this.calendars.findByNumber(year.value, revisionNumber);
      if (!own) {
        throw new SeasonCalendarNotFoundError(year.value, revisionNumber);
      }
      reference = own.effectiveAt;
      const found = await this.calendars.findEffectiveAt([year.value - 1], reference);
      previous = found.revisions[0] ?? null;
    } else {
      const found = await this.calendars.findEffectiveAt([year.value - 1, year.value], asOf);
      reference = found.asOf;
      own = found.revisions.find((r) => r.year === year.value) ?? null;
      previous = found.revisions.find((r) => r.year === year.value - 1) ?? null;
    }

    const catalog = indexSeasonCatalog(await this.catalog.getSnapshot(reference));
    const calendar = new YearCalendar(year, own, previous);
    const inspection = calendar.inspect(window, catalog);

    return {
      year: year.value,
      asOf: reference,
      revision: own?.revision ?? 0,
      effectiveAt: own?.effectiveAt ?? null,
      changedBy: own?.changedBy ?? null,
      changedAt: own?.changedAt ?? null,
      defaultSeason: seasonView(catalog.defaultSeasonId, catalog),
      entries: calendar.ownEntries().map((owned) => entryView(owned, catalog)),
      carriedInEntries: calendar.carriedIn().map((owned) => ({
        ...entryView(owned, catalog),
        ownerYear: owned.owner.year,
        ownerRevision: owned.owner.revision,
      })),
      unclassifiedRanges: inspection.unclassified.map((range) => ({
        from: range.start.toString(),
        to: range.end.toString(),
        resolvedAs: 'DEFAULT',
      })),
      conflicts: inspection.conflicts.map((conflict) => ({
        code: conflict.code,
        blocking: true,
        dates: { from: conflict.dates.start.toString(), to: conflict.dates.end.toString() },
        entryIds: conflict.entryIds,
        message: conflict.message,
      })),
    };
  }
}

// `from` y `to` se envían juntos o se omiten; sin ellos se revisa el año completo.
function parseWindow(from: unknown, to: unknown, year: CalendarYear): CalendarDateRange {
  if (from === undefined && to === undefined) {
    return CalendarDateRange.of(year.firstDay(), year.lastDay());
  }
  if (from === undefined || to === undefined) {
    throw new InvalidCalendarRangeError('from y to se envían juntos o se omiten los dos.');
  }
  const start = CalendarDate.of(from, 'from');
  const end = CalendarDate.of(to, 'to');
  if (!year.contains(start) || !year.contains(end)) {
    throw new InvalidCalendarRangeError(`from y to deben pertenecer al año ${year.value}.`);
  }
  return CalendarDateRange.of(start, end, 'La ventana consultada');
}

function parseInstant(raw: unknown): Date {
  if (typeof raw === 'string' && ISO_INSTANT.test(raw)) {
    CalendarDate.of(raw.slice(0, 10), 'asOf');
    const instant = new Date(raw);
    if (!Number.isNaN(instant.getTime())) {
      return instant;
    }
  }
  throw new InvalidCalendarRangeError(
    'asOf debe ser un instante ISO 8601 con zona horaria (por ejemplo 2026-10-09T22:00:00Z).',
  );
}

function parseRevision(raw: unknown): number {
  const text = typeof raw === 'number' ? String(raw) : raw;
  if (typeof text === 'string' && POSITIVE_INTEGER.test(text)) {
    return Number(text);
  }
  throw new InvalidCalendarRangeError('revision debe ser un entero mayor o igual a 1.');
}

function seasonView(seasonId: string, catalog: IndexedSeasonCatalog): CalendarSeasonView {
  const season = catalog.get(seasonId);
  return {
    seasonId,
    name: season?.name ?? null,
    color: season?.color ?? null,
    adjustmentPercent: season?.adjustmentPercent ?? null,
  };
}

function entryView({ entry }: OwnedEntry, catalog: IndexedSeasonCatalog): CalendarEntryView {
  return {
    entryId: entry.entryId,
    kind: entry.kind,
    startDate: entry.range.start.toString(),
    endDate: entry.range.end.toString(),
    season: seasonView(entry.seasonId, catalog),
  };
}
