// Feature 011 · Revisar temporada del año
import { InvalidCalendarRangeError } from '../../../domain/errors/pricing/invalid-calendar-range.error';
import { SeasonCalendarInconsistentError } from '../../../domain/errors/pricing/season-calendar-inconsistent.error';
import { SeasonCalendarUnavailableError } from '../../../domain/errors/pricing/season-calendar-unavailable.error';
import { SeasonCatalogInconsistentError } from '../../../domain/errors/pricing/season-catalog-inconsistent.error';
import { CalendarDate } from '../../../domain/model/pricing/calendar-date.vo';
import { CalendarYear } from '../../../domain/model/pricing/calendar-year.vo';
import { YearCalendar } from '../../../domain/model/pricing/season-calendar';
import { EffectiveSeasonRules } from '../../../domain/ports/in/pricing/get-effective-season-rules.use-case';
import {
  ResolveSeasonByDateQuery,
  ResolveSeasonByDateUseCase,
  SeasonClassification,
} from '../../../domain/ports/in/pricing/resolve-season-by-date.use-case';
import {
  EffectiveRevisions,
  SeasonCalendarRepositoryPort,
} from '../../../domain/ports/out/pricing/season-calendar.repository.port';
import { SeasonCatalogQueryPort } from '../../../domain/ports/out/pricing/season-catalog-query.port';
import { indexSeasonCatalog } from './season-catalog-lookup';

// Puerto interno para 005. Sin caché: una consulta con un asOf posterior a una
// publicación ya la ve; una con un asOf anterior no la mezcla (NFR-003).
export class ResolveSeasonByDateService implements ResolveSeasonByDateUseCase {
  constructor(
    private readonly calendars: SeasonCalendarRepositoryPort,
    private readonly catalog: SeasonCatalogQueryPort,
  ) {}

  async resolve(query: ResolveSeasonByDateQuery): Promise<SeasonClassification> {
    const date = CalendarDate.of(query?.date, 'date');
    const year = CalendarYear.of(date.year);
    const asOf = query?.asOf;
    if (!(asOf instanceof Date) || Number.isNaN(asOf.getTime())) {
      throw new InvalidCalendarRangeError('asOf debe ser un instante válido.');
    }

    let rules: EffectiveSeasonRules;
    try {
      rules = await this.catalog.getSnapshot(asOf);
    } catch (cause) {
      // Un catálogo sin una única temporada por defecto no se resuelve reintentando.
      if (cause instanceof SeasonCatalogInconsistentError) {
        throw new SeasonCalendarInconsistentError(cause.message);
      }
      throw new SeasonCalendarUnavailableError(cause);
    }

    let found: EffectiveRevisions;
    try {
      found = await this.calendars.findEffectiveAt([year.value - 1, year.value], asOf);
    } catch (cause) {
      throw new SeasonCalendarUnavailableError(cause);
    }

    const own = found.revisions.find((r) => r.year === year.value) ?? null;
    const previous = found.revisions.find((r) => r.year === year.value - 1) ?? null;
    const resolved = new YearCalendar(year, own, previous).resolve(date, indexSeasonCatalog(rules));
    const owner = resolved.applied?.owner ?? null;

    return {
      date: date.toString(),
      seasonId: resolved.seasonId,
      source: resolved.source,
      entryId: resolved.applied?.entry.entryId ?? null,
      calendarYear: year.value,
      revision: own?.revision ?? 0,
      calendarEffectiveAt: own ? own.effectiveAt.toISOString() : null,
      entryOwnerYear: owner?.year ?? null,
      entryOwnerRevision: owner?.revision ?? null,
      entryOwnerEffectiveAt: owner ? owner.effectiveAt.toISOString() : null,
    };
  }
}
