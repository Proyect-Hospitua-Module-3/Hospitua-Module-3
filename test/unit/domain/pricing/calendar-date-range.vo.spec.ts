// Feature 011 · Revisar temporada del año
// T005: CalendarDate, CalendarYear y CalendarDateRange (fechas civiles inclusivas).
import { InvalidCalendarRangeError } from '../../../../src/domain/errors/pricing/invalid-calendar-range.error';
import { CalendarDateRange } from '../../../../src/domain/model/pricing/calendar-date-range.vo';
import { CalendarDate } from '../../../../src/domain/model/pricing/calendar-date.vo';
import { CalendarYear } from '../../../../src/domain/model/pricing/calendar-year.vo';

const d = (value: string) => CalendarDate.of(value);

describe('CalendarDate', () => {
  it.each(['2026-01-01', '2026-12-31', '2024-02-29', '2000-02-29', '0001-01-01', '9999-12-31'])(
    'acepta %s y lo devuelve igual',
    (value) => {
      expect(d(value).toString()).toBe(value);
    },
  );

  it.each([
    ['día inexistente', '2026-02-30'],
    ['29 de febrero en año no bisiesto', '2025-02-29'],
    ['1900 no es bisiesto', '1900-02-29'],
    ['mes 13', '2026-13-01'],
    ['día 00', '2026-01-00'],
    ['año 0000', '0000-01-01'],
    ['sin ceros a la izquierda', '2026-1-5'],
    ['con hora', '2026-01-01T00:00:00Z'],
    ['con espacios', ' 2026-01-01'],
    ['número', 20260101],
    ['vacío', ''],
  ])('rechaza %s con INVALID_CALENDAR_RANGE', (_case, value) => {
    expect(() => CalendarDate.of(value)).toThrow(InvalidCalendarRangeError);
  });

  it('cuenta días sin depender de la zona horaria: 1970-01-01 es el día 0', () => {
    expect(d('1970-01-01').epochDay).toBe(0);
    expect(d('2026-12-31').addDays(1).toString()).toBe('2027-01-01');
    expect(d('2024-02-28').addDays(1).toString()).toBe('2024-02-29');
    expect(d('2024-03-01').addDays(-1).toString()).toBe('2024-02-29');
  });

  it('compara y expone el año', () => {
    expect(d('2026-06-01').isBefore(d('2026-06-02'))).toBe(true);
    expect(d('2026-06-02').isAfter(d('2026-06-01'))).toBe(true);
    expect(d('2026-06-01').equals(d('2026-06-01'))).toBe(true);
    expect(d('0099-07-04').year).toBe(99);
  });
});

describe('CalendarYear', () => {
  it.each([
    ['texto', '2026', 2026],
    ['número', 2026, 2026],
    ['límite inferior', '1', 1],
    ['límite superior', 9999, 9999],
  ])('acepta %s', (_case, raw, expected) => {
    expect(CalendarYear.of(raw).value).toBe(expected);
  });

  it.each([['0'], ['10000'], ['2026.5'], [2026.5], [''], ['abc'], ['-1'], [' 2026'], [null]])(
    'rechaza %p',
    (raw) => {
      expect(() => CalendarYear.of(raw)).toThrow(InvalidCalendarRangeError);
    },
  );

  it('un BASE del año puede llegar hasta el 31 de diciembre del año siguiente', () => {
    const year = CalendarYear.of(2026);
    expect(year.firstDay().toString()).toBe('2026-01-01');
    expect(year.lastDay().toString()).toBe('2026-12-31');
    expect(year.lastDayOfNextYear().toString()).toBe('2027-12-31');
    expect(year.contains(d('2026-07-04'))).toBe(true);
    expect(year.contains(d('2027-01-01'))).toBe(false);
  });
});

describe('CalendarDateRange', () => {
  it('es inclusivo en los dos extremos y admite un solo día', () => {
    const range = CalendarDateRange.of(d('2026-06-01'), d('2026-08-31'));
    expect(range.contains(d('2026-06-01'))).toBe(true);
    expect(range.contains(d('2026-08-31'))).toBe(true);
    expect(range.contains(d('2026-09-01'))).toBe(false);
    expect([...CalendarDateRange.of(d('2026-07-04'), d('2026-07-04')).days()]).toHaveLength(1);
  });

  it('rechaza un fin anterior al inicio', () => {
    expect(() => CalendarDateRange.of(d('2026-06-02'), d('2026-06-01'))).toThrow(
      InvalidCalendarRangeError,
    );
  });

  it('calcula los días en común', () => {
    const a = CalendarDateRange.of(d('2026-06-01'), d('2026-06-30'));
    expect(a.intersection(CalendarDateRange.of(d('2026-06-30'), d('2026-07-10')))?.toString()).toBe(
      '2026-06-30',
    );
    expect(a.intersection(CalendarDateRange.of(d('2026-07-01'), d('2026-07-10')))).toBeNull();
  });

  it('recorre todos los días de un año bisiesto', () => {
    const year = CalendarYear.of(2024);
    expect([...CalendarDateRange.of(year.firstDay(), year.lastDay()).days()]).toHaveLength(366);
  });
});
