// Feature 011 · Revisar temporada del año
// T012, T020, T028: publicación (validación del borrador), precedencia
// EXCEPTION > BASE > DEFAULT y revisión de huecos y conflictos.
import { DuplicateSeasonExceptionError } from '../../../../src/domain/errors/pricing/duplicate-season-exception.error';
import { InvalidCalendarRangeError } from '../../../../src/domain/errors/pricing/invalid-calendar-range.error';
import { OverlappingSeasonCalendarError } from '../../../../src/domain/errors/pricing/overlapping-season-calendar.error';
import { SeasonCalendarConflictError } from '../../../../src/domain/errors/pricing/season-calendar-conflict.error';
import { SeasonCalendarInconsistentError } from '../../../../src/domain/errors/pricing/season-calendar-inconsistent.error';
import { UnknownSeasonReferenceError } from '../../../../src/domain/errors/pricing/unknown-season-reference.error';
import { CalendarDateRange } from '../../../../src/domain/model/pricing/calendar-date-range.vo';
import { CalendarDate } from '../../../../src/domain/model/pricing/calendar-date.vo';
import { CalendarYear } from '../../../../src/domain/model/pricing/calendar-year.vo';
import {
  NeighborBase,
  PublicationContext,
  SeasonCalendarDraft,
  SeasonCalendarRevision,
  SeasonCatalogLookup,
  YearCalendar,
} from '../../../../src/domain/model/pricing/season-calendar';
import {
  CalendarEntryKind,
  SeasonCalendarEntry,
} from '../../../../src/domain/model/pricing/season-calendar-entry';

const REGULAR = '00000000-0000-4000-8000-000000000001';
const ALTA = '5dca644e-7a6a-4d2e-a9a5-1943188c4710';
const EVENTO = 'a2a61e70-57e3-41c4-9dc1-4b124a21a441';
const ADMIN = 'f2d3b4a5-6c7d-4e8f-9012-3456789abcde';

const d = (value: string) => CalendarDate.of(value);
let sequence = 0;
const nextId = () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`;

function stored(
  id: string,
  kind: CalendarEntryKind,
  start: string,
  end: string,
  seasonId = ALTA,
): SeasonCalendarEntry {
  return new SeasonCalendarEntry(id, seasonId, kind, CalendarDateRange.of(d(start), d(end)));
}

function revision(
  year: number,
  number: number,
  entries: SeasonCalendarEntry[],
): SeasonCalendarRevision {
  const at = new Date(Date.UTC(2026, 0, number));
  return new SeasonCalendarRevision(year, number, at, ADMIN, at, entries);
}

function draft(
  entries: object[],
  expectedRevision?: unknown,
  year: unknown = 2026,
): SeasonCalendarDraft {
  return SeasonCalendarDraft.parse({ year, expectedRevision, entries }, nextId);
}

function context(overrides: Partial<PublicationContext> = {}): PublicationContext {
  return {
    activeRevision: 0,
    activeSeasonIds: new Set([ALTA, EVENTO, REGULAR]),
    neighborBases: [],
    ...overrides,
  };
}

const catalog: SeasonCatalogLookup = {
  defaultSeasonId: REGULAR,
  has: (id) => [REGULAR, ALTA, EVENTO].includes(id),
};

const base = (startDate: string, endDate: string, seasonId = ALTA) => ({
  seasonId,
  kind: 'BASE',
  startDate,
  endDate,
});
const exception = (date: string, seasonId = EVENTO) => ({
  seasonId,
  kind: 'EXCEPTION',
  startDate: date,
  endDate: date,
});

describe('SeasonCalendarDraft.parse', () => {
  it('acepta una lista vacía: todas las fechas sin BASE heredado quedan en el default', () => {
    expect(draft([]).entries).toHaveLength(0);
  });

  it.each([
    ['entries no es una lista', { year: 2026, entries: 'x' }],
    ['entries ausente', { year: 2026 }],
    ['una entrada no es un objeto', { year: 2026, entries: [42] }],
    ['año inválido', { year: 'abc', entries: [] }],
    ['expectedRevision como texto', { year: 2026, expectedRevision: '3', entries: [] }],
    ['expectedRevision negativo', { year: 2026, expectedRevision: -1, entries: [] }],
    ['expectedRevision decimal', { year: 2026, expectedRevision: 1.5, entries: [] }],
  ])('rechaza %s con INVALID_CALENDAR_RANGE', (_case, input) => {
    expect(() => SeasonCalendarDraft.parse(input as never, nextId)).toThrow(
      InvalidCalendarRangeError,
    );
  });

  it('rechaza el mismo entryId dos veces', () => {
    const entryId = 'e6cfa8ed-8b7f-4cb4-bbf8-0678180d1f91';
    expect(() =>
      draft([
        { ...base('2026-01-01', '2026-01-31'), entryId },
        { ...base('2026-02-01', '2026-02-28'), entryId },
      ]),
    ).toThrow(InvalidCalendarRangeError);
  });

  it('acepta null o 0 como "el año aún no tiene revisión"', () => {
    expect(draft([], null).expectedRevision).toBeNull();
    expect(draft([], 0).expectedRevision).toBe(0);
    expect(draft([]).expectedRevision).toBeUndefined();
  });
});

describe('SeasonCalendarDraft.assertPublishable', () => {
  describe('control optimista (expectedRevision)', () => {
    it('sin expectedRevision no compara', () => {
      expect(() => draft([]).assertPublishable(context({ activeRevision: 7 }))).not.toThrow();
    });

    it('acepta la revisión activa', () => {
      expect(() => draft([], 4).assertPublishable(context({ activeRevision: 4 }))).not.toThrow();
    });

    it.each([
      ['desactualizado', 3, 4],
      ['null cuando ya hay revisión', null, 2],
      ['0 cuando ya hay revisión', 0, 2],
      ['un número cuando aún no hay revisión', 1, 0],
    ])('rechaza un expectedRevision %s con SEASON_CALENDAR_CONFLICT', (_case, expected, active) => {
      expect(() =>
        draft([], expected).assertPublishable(context({ activeRevision: active })),
      ).toThrow(SeasonCalendarConflictError);
    });
  });

  it('rechaza temporadas que no están activas en el catálogo, listándolas (FR-010)', () => {
    const retired = '3c4d5e6f-7a8b-4c9d-8e0f-1a2b3c4d5e6f';
    const attempt = () =>
      draft([
        base('2026-01-01', '2026-01-31', retired),
        exception('2026-07-04', 'no-es-uuid'),
      ]).assertPublishable(context());
    expect(attempt).toThrow(UnknownSeasonReferenceError);
    expect(attempt).toThrow(new RegExp(`${retired}.*no-es-uuid|no-es-uuid.*${retired}`));
  });

  it('rechaza dos excepciones para la misma fecha aunque apunten a la misma temporada', () => {
    expect(() =>
      draft([exception('2026-07-04'), exception('2026-07-04')]).assertPublishable(context()),
    ).toThrow(DuplicateSeasonExceptionError);
  });

  it('acepta una excepción sobre un período BASE: la excepción lo sobrescribe (T028)', () => {
    expect(() =>
      draft([base('2026-06-01', '2026-08-31'), exception('2026-07-04')]).assertPublishable(
        context(),
      ),
    ).not.toThrow();
  });

  it('rechaza dos BASE que comparten un solo día, con las fechas en el mensaje', () => {
    const attempt = () =>
      draft([base('2026-06-01', '2026-06-30'), base('2026-06-30', '2026-07-31')]).assertPublishable(
        context(),
      );
    expect(attempt).toThrow(OverlappingSeasonCalendarError);
    expect(attempt).toThrow(/comparten 2026-06-30/);
  });

  it('acepta dos BASE contiguos', () => {
    expect(() =>
      draft([base('2026-06-01', '2026-06-30'), base('2026-07-01', '2026-07-31')]).assertPublishable(
        context(),
      ),
    ).not.toThrow();
  });

  it('rechaza un BASE que se cruza con el BASE heredado del año anterior (T040)', () => {
    const neighbor: NeighborBase = {
      entry: stored(nextId(), 'BASE', '2025-12-20', '2026-01-10'),
      ownerYear: 2025,
      ownerRevision: 3,
    };
    const attempt = () =>
      draft([base('2026-01-05', '2026-02-28')]).assertPublishable(
        context({ neighborBases: [neighbor] }),
      );
    expect(attempt).toThrow(OverlappingSeasonCalendarError);
    expect(attempt).toThrow(/calendario 2025 \(revisión 3\)/);
  });

  it('rechaza un BASE que cruza al año siguiente sobre un BASE ya publicado de ese año (T040)', () => {
    const neighbor: NeighborBase = {
      entry: stored(nextId(), 'BASE', '2027-01-05', '2027-01-31'),
      ownerYear: 2027,
      ownerRevision: 1,
    };
    expect(() =>
      draft([base('2026-12-20', '2027-01-10')]).assertPublishable(
        context({ neighborBases: [neighbor] }),
      ),
    ).toThrow(OverlappingSeasonCalendarError);
  });

  it('valida en el orden del contrato: conflicto → referencias → excepciones duplicadas → solapes', () => {
    const everythingWrong = draft(
      [
        base('2026-01-01', '2026-01-31', 'x'),
        base('2026-01-15', '2026-02-15'),
        exception('2026-07-04'),
        exception('2026-07-04'),
      ],
      9,
    );
    expect(() => everythingWrong.assertPublishable(context({ activeRevision: 1 }))).toThrow(
      SeasonCalendarConflictError,
    );
    expect(() => everythingWrong.assertPublishable(context({ activeRevision: 9 }))).toThrow(
      UnknownSeasonReferenceError,
    );
    const noUnknown = draft([
      base('2026-01-01', '2026-01-31'),
      base('2026-01-15', '2026-02-15'),
      exception('2026-07-04'),
      exception('2026-07-04'),
    ]);
    expect(() => noUnknown.assertPublishable(context())).toThrow(DuplicateSeasonExceptionError);
  });
});

describe('YearCalendar.resolve', () => {
  const year2026 = CalendarYear.of(2026);
  const own = revision(2026, 5, [
    stored('base-verano', 'BASE', '2026-06-01', '2026-08-31'),
    stored('excepcion-4-julio', 'EXCEPTION', '2026-07-04', '2026-07-04', EVENTO),
  ]);
  const previous = revision(2025, 3, [
    stored('base-navidad', 'BASE', '2025-12-20', '2026-01-10'),
    stored('base-solo-2025', 'BASE', '2025-03-01', '2025-03-31'),
  ]);
  const calendar = new YearCalendar(year2026, own, previous);

  it('aplica el BASE propio, con sus límites inclusivos', () => {
    for (const date of ['2026-06-01', '2026-07-15', '2026-08-31']) {
      expect(calendar.resolve(d(date), catalog)).toMatchObject({ seasonId: ALTA, source: 'BASE' });
    }
  });

  it('la excepción prevalece sobre el BASE propio (BR-002)', () => {
    const resolved = calendar.resolve(d('2026-07-04'), catalog);
    expect(resolved).toMatchObject({ seasonId: EVENTO, source: 'EXCEPTION' });
    expect(resolved.applied?.entry.entryId).toBe('excepcion-4-julio');
  });

  it('aplica el BASE heredado del año anterior e indica su revisión dueña', () => {
    const resolved = calendar.resolve(d('2026-01-10'), catalog);
    expect(resolved).toMatchObject({ seasonId: ALTA, source: 'BASE' });
    expect(resolved.applied?.owner.year).toBe(2025);
    expect(resolved.applied?.owner.revision).toBe(3);
  });

  it('la excepción prevalece también sobre el BASE heredado', () => {
    const withException = new YearCalendar(
      year2026,
      revision(2026, 1, [stored('reyes', 'EXCEPTION', '2026-01-06', '2026-01-06', EVENTO)]),
      previous,
    );
    expect(withException.resolve(d('2026-01-06'), catalog)).toMatchObject({
      seasonId: EVENTO,
      source: 'EXCEPTION',
    });
  });

  it('una fecha sin clasificación usa el default del catálogo, sea cual sea su id (FR-003)', () => {
    expect(calendar.resolve(d('2026-01-11'), catalog)).toMatchObject({
      seasonId: REGULAR,
      source: 'DEFAULT',
      applied: null,
    });
    const otherDefault: SeasonCatalogLookup = { defaultSeasonId: EVENTO, has: () => true };
    expect(calendar.resolve(d('2026-05-01'), otherDefault).seasonId).toBe(EVENTO);
  });

  it('sin revisión propia sigue mirando el año anterior', () => {
    const onlyPrevious = new YearCalendar(year2026, null, previous);
    expect(onlyPrevious.resolve(d('2026-01-05'), catalog).source).toBe('BASE');
    expect(onlyPrevious.resolve(d('2026-01-11'), catalog).source).toBe('DEFAULT');
  });

  it('falla, sin elegir uno, si dos BASE cubren la fecha (datos corruptos entre años)', () => {
    const corrupt = new YearCalendar(
      year2026,
      revision(2026, 1, [stored('enero', 'BASE', '2026-01-01', '2026-01-31')]),
      previous,
    );
    expect(() => corrupt.resolve(d('2026-01-05'), catalog)).toThrow(
      SeasonCalendarInconsistentError,
    );
    expect(corrupt.resolve(d('2026-01-20'), catalog).source).toBe('BASE');
  });

  it('falla si hay dos excepciones para la fecha', () => {
    const corrupt = new YearCalendar(
      year2026,
      revision(2026, 1, [
        stored('a', 'EXCEPTION', '2026-07-04', '2026-07-04'),
        stored('b', 'EXCEPTION', '2026-07-04', '2026-07-04'),
      ]),
      null,
    );
    expect(() => corrupt.resolve(d('2026-07-04'), catalog)).toThrow(
      SeasonCalendarInconsistentError,
    );
  });

  it('falla, sin caer al default, si la temporada asignada no está en el catálogo', () => {
    const broken = new YearCalendar(
      year2026,
      revision(2026, 1, [stored('x', 'BASE', '2026-03-01', '2026-03-31', 'temporada-borrada')]),
      null,
    );
    expect(() => broken.resolve(d('2026-03-15'), catalog)).toThrow(SeasonCalendarInconsistentError);
  });
});

describe('YearCalendar.inspect', () => {
  const year2026 = CalendarYear.of(2026);
  const fullYear = CalendarDateRange.of(year2026.firstDay(), year2026.lastDay());
  const own = revision(2026, 5, [
    stored('verano', 'BASE', '2026-06-01', '2026-08-31'),
    stored('4-julio', 'EXCEPTION', '2026-07-04', '2026-07-04', EVENTO),
  ]);
  const previous = revision(2025, 3, [stored('navidad', 'BASE', '2025-12-20', '2026-01-10')]);

  it('compacta las fechas sin clasificación en rangos contiguos (ejemplo del contrato)', () => {
    const { unclassified, conflicts } = new YearCalendar(year2026, own, previous).inspect(
      fullYear,
      catalog,
    );
    expect(unclassified.map((r) => r.toString())).toEqual([
      '2026-01-11 a 2026-05-31',
      '2026-09-01 a 2026-12-31',
    ]);
    expect(conflicts).toEqual([]);
  });

  it('respeta la ventana consultada', () => {
    const window = CalendarDateRange.of(d('2026-05-15'), d('2026-06-15'));
    const { unclassified } = new YearCalendar(year2026, own, previous).inspect(window, catalog);
    expect(unclassified.map((r) => r.toString())).toEqual(['2026-05-15 a 2026-05-31']);
  });

  it('un año sin revisiones queda entero en el default', () => {
    const { unclassified } = new YearCalendar(year2026, null, null).inspect(fullYear, catalog);
    expect(unclassified.map((r) => r.toString())).toEqual(['2026-01-01 a 2026-12-31']);
  });

  it('señala, sin lanzar, los solapes y excepciones duplicadas de datos heredados', () => {
    const corrupt = new YearCalendar(
      year2026,
      revision(2026, 1, [
        stored('enero', 'BASE', '2026-01-05', '2026-01-31'),
        stored('a', 'EXCEPTION', '2026-07-04', '2026-07-04'),
        stored('b', 'EXCEPTION', '2026-07-04', '2026-07-04'),
      ]),
      previous,
    );
    const { conflicts } = corrupt.inspect(fullYear, catalog);
    expect(conflicts).toEqual([
      expect.objectContaining({
        code: 'OVERLAPPING_SEASON_CALENDAR',
        entryIds: ['enero', 'navidad'],
      }),
      expect.objectContaining({ code: 'DUPLICATE_SEASON_EXCEPTION', entryIds: ['a', 'b'] }),
    ]);
    expect(conflicts[0].dates.toString()).toBe('2026-01-05 a 2026-01-10');
    expect(conflicts[1].dates.toString()).toBe('2026-07-04');
  });

  it('señala las entradas que apuntan a una temporada que no está en el catálogo', () => {
    const broken = new YearCalendar(
      year2026,
      revision(2026, 1, [stored('x', 'BASE', '2026-03-01', '2026-03-31', 'borrada')]),
      null,
    );
    const { conflicts } = broken.inspect(fullYear, catalog);
    expect(conflicts).toEqual([
      expect.objectContaining({ code: 'UNKNOWN_SEASON_REFERENCE', entryIds: ['x'] }),
    ]);
  });
});
