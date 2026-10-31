// Feature 011 · Revisar temporada del año
// T013, T016, T018: lectura administrativa del calendario.
import { ReplaceSeasonCalendarService } from '../../../../src/application/services/pricing/replace-season-calendar.service';
import { ReviewSeasonCalendarService } from '../../../../src/application/services/pricing/review-season-calendar.service';
import { InvalidCalendarRangeError } from '../../../../src/domain/errors/pricing/invalid-calendar-range.error';
import { SeasonCalendarNotFoundError } from '../../../../src/domain/errors/pricing/season-calendar-not-found.error';
import {
  ALTA_ID,
  BAJA_ID,
  EVENTO_ID,
  FakeSeasonCatalog,
} from '../../../support/pricing/fake-season-catalog';
import {
  InMemorySeasonCalendarRepository,
  steppingClock,
} from '../../../support/pricing/in-memory-season-calendar.repository';
import { REGULAR_ID } from '../../../support/pricing/in-memory-season-rule.repository';

const ADMIN = 'f2d3b4a5-6c7d-4e8f-9012-3456789abcde';
const base = (startDate: string, endDate: string, seasonId = ALTA_ID) => ({
  seasonId,
  kind: 'BASE',
  startDate,
  endDate,
});

describe('ReviewSeasonCalendarService', () => {
  let catalog: FakeSeasonCatalog;
  let repository: InMemorySeasonCalendarRepository;
  let service: ReviewSeasonCalendarService;
  let publisher: ReplaceSeasonCalendarService;

  beforeEach(() => {
    catalog = new FakeSeasonCatalog();
    repository = new InMemorySeasonCalendarRepository(steppingClock(), (ids) =>
      catalog.activeIds(ids),
    );
    service = new ReviewSeasonCalendarService(repository, catalog);
    publisher = new ReplaceSeasonCalendarService(repository, service);
  });

  const publish = (year: number, entries: object[]) =>
    publisher.replace({ year, entries, actorId: ADMIN });

  describe('validación (FR-007: sin resultado parcial)', () => {
    it.each([
      ['sin año', {}],
      ['año inválido', { year: '20x6' }],
      ['from sin to', { year: '2026', from: '2026-01-01' }],
      ['to sin from', { year: '2026', to: '2026-01-31' }],
      ['ventana fuera del año', { year: '2026', from: '2026-12-01', to: '2027-01-15' }],
      ['from posterior a to', { year: '2026', from: '2026-03-10', to: '2026-03-01' }],
      ['fecha inexistente', { year: '2026', from: '2026-02-30', to: '2026-03-01' }],
      ['asOf y revision a la vez', { year: '2026', asOf: '2026-10-01T00:00:00Z', revision: '1' }],
      ['asOf sin hora', { year: '2026', asOf: '2026-10-01' }],
      ['asOf sin zona horaria', { year: '2026', asOf: '2026-10-01T00:00:00' }],
      ['asOf con fecha inexistente', { year: '2026', asOf: '2026-02-30T00:00:00Z' }],
      ['asOf de texto libre', { year: '2026', asOf: 'mañana' }],
      ['revision 0', { year: '2026', revision: '0' }],
      ['revision no numérica', { year: '2026', revision: 'ultima' }],
    ])('rechaza %s con INVALID_CALENDAR_RANGE', async (_case, query) => {
      await expect(service.review(query as never)).rejects.toThrow(InvalidCalendarRangeError);
    });
  });

  it('sin revisión publicada responde revisión 0, todo el año en el default y la temporada por defecto', async () => {
    const view = await service.review({ year: '2026' });

    expect(view).toMatchObject({
      year: 2026,
      revision: 0,
      effectiveAt: null,
      changedBy: null,
      changedAt: null,
      entries: [],
      carriedInEntries: [],
      unclassifiedRanges: [{ from: '2026-01-01', to: '2026-12-31', resolvedAs: 'DEFAULT' }],
      conflicts: [],
    });
    expect(view.defaultSeason).toEqual({
      seasonId: REGULAR_ID,
      name: 'Regular',
      color: '#808080',
      adjustmentPercent: '-2.50',
    });
  });

  it('incluye los BASE heredados del año anterior aunque el año no tenga revisión propia', async () => {
    await publish(2026, [base('2026-12-20', '2027-01-10')]);

    const view = await service.review({ year: '2027' });

    expect(view.revision).toBe(0);
    expect(view.carriedInEntries).toEqual([
      expect.objectContaining({
        ownerYear: 2026,
        ownerRevision: 1,
        kind: 'BASE',
        startDate: '2026-12-20',
        endDate: '2027-01-10',
      }),
    ]);
    expect(view.unclassifiedRanges).toEqual([
      { from: '2027-01-11', to: '2027-12-31', resolvedAs: 'DEFAULT' },
    ]);
  });

  it('adjunta nombre, color y ajuste del catálogo de 009 (FR-002)', async () => {
    await publish(2026, [base('2026-02-01', '2026-03-31', BAJA_ID)]);

    const view = await service.review({ year: '2026' });

    expect(view.entries[0].season).toEqual({
      seasonId: BAJA_ID,
      name: 'Baja',
      color: '#2980B9',
      adjustmentPercent: '-15.00',
    });
  });

  it('pregunta al catálogo por el mismo instante de referencia de la lectura', async () => {
    const view = await service.review({ year: '2026', asOf: '2026-12-01T10:00:00-05:00' });

    expect(view.asOf.toISOString()).toBe('2026-12-01T15:00:00.000Z');
    expect(catalog.askedAt[catalog.askedAt.length - 1].toISOString()).toBe(
      '2026-12-01T15:00:00.000Z',
    );
  });

  it('con asOf lee la revisión efectiva en ese instante, no la activa (FR-008)', async () => {
    const first = await publish(2026, [base('2026-06-01', '2026-08-31')]);
    await publisher.replace({
      year: 2026,
      entries: [base('2026-07-01', '2026-08-31', EVENTO_ID)],
      expectedRevision: 1,
      actorId: ADMIN,
    });

    const view = await service.review({ year: '2026', asOf: first.effectiveAt!.toISOString() });

    expect(view.revision).toBe(1);
    expect(view.entries[0].startDate).toBe('2026-06-01');
  });

  it('una revisión histórica se muestra con el año anterior tal como estaba en su vigencia', async () => {
    await publish(2026, []);
    await publish(2025, [base('2025-12-20', '2026-01-10')]);

    const historical = await service.review({ year: '2026', revision: '1' });
    const current = await service.review({ year: '2026' });

    expect(historical.carriedInEntries).toEqual([]);
    expect(current.carriedInEntries).toHaveLength(1);
  });

  it('una revisión histórica inexistente responde SEASON_CALENDAR_NOT_FOUND', async () => {
    await expect(service.review({ year: '2026', revision: '3' })).rejects.toThrow(
      SeasonCalendarNotFoundError,
    );
  });

  it('una entrada cuya temporada no está en el catálogo se muestra sin datos y como conflicto', async () => {
    await publish(2026, [base('2026-03-01', '2026-03-31')]);
    catalog.seasons = catalog.seasons.filter((s) => s.seasonId !== ALTA_ID);

    const view = await service.review({ year: '2026' });

    expect(view.entries[0].season).toEqual({
      seasonId: ALTA_ID,
      name: null,
      color: null,
      adjustmentPercent: null,
    });
    expect(view.conflicts).toEqual([
      expect.objectContaining({
        code: 'UNKNOWN_SEASON_REFERENCE',
        blocking: true,
        dates: { from: '2026-03-01', to: '2026-03-31' },
      }),
    ]);
  });
});
