// Feature 011 · Revisar temporada del año
// T020, T024: errores del puerto de resolución que consume 005.
import { ResolveSeasonByDateService } from '../../../../src/application/services/pricing/resolve-season-by-date.service';
import { InvalidCalendarRangeError } from '../../../../src/domain/errors/pricing/invalid-calendar-range.error';
import { SeasonCalendarInconsistentError } from '../../../../src/domain/errors/pricing/season-calendar-inconsistent.error';
import { SeasonCalendarUnavailableError } from '../../../../src/domain/errors/pricing/season-calendar-unavailable.error';
import { SeasonCatalogInconsistentError } from '../../../../src/domain/errors/pricing/season-catalog-inconsistent.error';
import { SeasonRulesUnavailableError } from '../../../../src/domain/errors/pricing/season-rules-unavailable.error';
import { FakeSeasonCatalog } from '../../../support/pricing/fake-season-catalog';
import {
  InMemorySeasonCalendarRepository,
  steppingClock,
} from '../../../support/pricing/in-memory-season-calendar.repository';

describe('ResolveSeasonByDateService', () => {
  let catalog: FakeSeasonCatalog;
  let repository: InMemorySeasonCalendarRepository;
  let service: ResolveSeasonByDateService;
  const asOf = new Date('2026-10-09T22:00:00Z');

  beforeEach(() => {
    catalog = new FakeSeasonCatalog();
    repository = new InMemorySeasonCalendarRepository(steppingClock(), (ids) =>
      catalog.activeIds(ids),
    );
    service = new ResolveSeasonByDateService(repository, catalog);
  });

  it.each([
    ['fecha con hora', { date: '2026-07-04T00:00:00Z', asOf }],
    ['fecha inexistente', { date: '2026-02-30', asOf }],
    ['asOf ausente', { date: '2026-07-04' }],
    ['asOf inválido', { date: '2026-07-04', asOf: new Date('no') }],
    ['asOf como texto', { date: '2026-07-04', asOf: '2026-10-09T22:00:00Z' }],
  ])('rechaza %s con INVALID_CALENDAR_RANGE', async (_case, query) => {
    await expect(service.resolve(query as never)).rejects.toThrow(InvalidCalendarRangeError);
  });

  it('un catálogo que no responde es SEASON_CALENDAR_UNAVAILABLE (reintentable)', async () => {
    catalog.failWith = new SeasonRulesUnavailableError(new Error('timeout'));
    await expect(service.resolve({ date: '2026-07-04', asOf })).rejects.toThrow(
      SeasonCalendarUnavailableError,
    );
  });

  it('un catálogo sin una única temporada por defecto es SEASON_CALENDAR_INCONSISTENT (no reintentable)', async () => {
    catalog.failWith = new SeasonCatalogInconsistentError(0);
    await expect(service.resolve({ date: '2026-07-04', asOf })).rejects.toThrow(
      SeasonCalendarInconsistentError,
    );
  });

  it('un calendario que no se puede leer es SEASON_CALENDAR_UNAVAILABLE, nunca el default', async () => {
    repository.failWith = new Error('conexión perdida');
    await expect(service.resolve({ date: '2026-07-04', asOf })).rejects.toThrow(
      SeasonCalendarUnavailableError,
    );
  });

  it('pregunta al catálogo con el mismo asOf que recibe', async () => {
    await service.resolve({ date: '2026-07-04', asOf });
    expect(catalog.askedAt).toEqual([asOf]);
  });
});
