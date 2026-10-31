// Feature 011 · Revisar temporada del año
// T006, T013: validación de una entrada contra su año propietario.
import { InvalidCalendarRangeError } from '../../../../src/domain/errors/pricing/invalid-calendar-range.error';
import { CalendarYear } from '../../../../src/domain/model/pricing/calendar-year.vo';
import {
  RawCalendarEntry,
  SeasonCalendarEntry,
} from '../../../../src/domain/model/pricing/season-calendar-entry';

const SEASON = '5dca644e-7a6a-4d2e-a9a5-1943188c4710';
const GENERATED = '11111111-1111-4111-8111-111111111111';
const year2026 = CalendarYear.of(2026);

function entry(raw: RawCalendarEntry, year = year2026): SeasonCalendarEntry {
  return SeasonCalendarEntry.forPublication(raw, year, 0, () => GENERATED);
}

const base = (startDate: string, endDate: string): RawCalendarEntry => ({
  seasonId: SEASON,
  kind: 'BASE',
  startDate,
  endDate,
});

describe('SeasonCalendarEntry.forPublication', () => {
  it('acepta un BASE dentro del año', () => {
    const created = entry(base('2026-06-01', '2026-08-31'));
    expect(created.kind).toBe('BASE');
    expect(created.range.toString()).toBe('2026-06-01 a 2026-08-31');
    expect(created.entryId).toBe(GENERATED);
  });

  it('acepta un BASE que cruza el 31 de diciembre (BR-006)', () => {
    expect(entry(base('2026-12-20', '2027-01-10')).range.end.toString()).toBe('2027-01-10');
  });

  it('acepta un BASE que llega justo al 31 de diciembre del año siguiente', () => {
    expect(entry(base('2026-01-01', '2027-12-31')).range.end.toString()).toBe('2027-12-31');
  });

  it.each([
    ['BASE que excede el año siguiente', base('2026-12-01', '2028-01-01')],
    ['inicio fuera del año propietario', base('2025-12-31', '2026-01-10')],
    ['inicio en el año siguiente', base('2027-01-01', '2027-01-10')],
    ['fin anterior al inicio', base('2026-06-10', '2026-06-01')],
    [
      'EXCEPTION de más de un día',
      { seasonId: SEASON, kind: 'EXCEPTION', startDate: '2026-07-04', endDate: '2026-07-05' },
    ],
    [
      'EXCEPTION fuera del año',
      { seasonId: SEASON, kind: 'EXCEPTION', startDate: '2027-01-01', endDate: '2027-01-01' },
    ],
    [
      'kind desconocido',
      { seasonId: SEASON, kind: 'HIGH', startDate: '2026-07-04', endDate: '2026-07-04' },
    ],
    [
      'kind en minúsculas',
      { seasonId: SEASON, kind: 'base', startDate: '2026-07-04', endDate: '2026-07-04' },
    ],
    ['sin seasonId', { kind: 'BASE', startDate: '2026-07-04', endDate: '2026-07-04' }],
    [
      'seasonId vacío',
      { seasonId: ' ', kind: 'BASE', startDate: '2026-07-04', endDate: '2026-07-04' },
    ],
    ['entryId que no es UUID', { ...base('2026-06-01', '2026-06-02'), entryId: 'abc' }],
    ['fecha inexistente', base('2026-02-30', '2026-03-01')],
    ['sin endDate', { seasonId: SEASON, kind: 'BASE', startDate: '2026-07-04' }],
  ])('rechaza %s con INVALID_CALENDAR_RANGE', (_case, raw) => {
    expect(() => entry(raw as RawCalendarEntry)).toThrow(InvalidCalendarRangeError);
  });

  it('acepta una EXCEPTION de un solo día', () => {
    const created = entry({
      seasonId: SEASON,
      kind: 'EXCEPTION',
      startDate: '2026-07-04',
      endDate: '2026-07-04',
    });
    expect(created.isException).toBe(true);
  });

  it('conserva el entryId que envía el cliente, en minúsculas', () => {
    const created = entry({
      ...base('2026-06-01', '2026-06-02'),
      entryId: 'E6CFA8ED-8B7F-4CB4-BBF8-0678180D1F91',
    });
    expect(created.entryId).toBe('e6cfa8ed-8b7f-4cb4-bbf8-0678180d1f91');
  });

  it('normaliza el seasonId UUID a minúsculas y deja pasar uno que no es UUID para rechazarlo después como referencia desconocida', () => {
    expect(
      entry({ ...base('2026-06-01', '2026-06-02'), seasonId: SEASON.toUpperCase() }).seasonId,
    ).toBe(SEASON);
    expect(entry({ ...base('2026-06-01', '2026-06-02'), seasonId: 'alta' }).seasonId).toBe('alta');
  });

  it('el mensaje indica qué entrada falla', () => {
    expect(() =>
      SeasonCalendarEntry.forPublication(
        base('2025-01-01', '2025-01-02'),
        year2026,
        3,
        () => GENERATED,
      ),
    ).toThrow(/entries\[3\]/);
  });
});
