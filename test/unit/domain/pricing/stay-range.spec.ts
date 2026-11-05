// Feature 005 · Consultar tarifa dinámica (T007)
import { InvalidDateRangeError } from '../../../../src/domain/errors/pricing/invalid-date-range.error';
import { CalendarDate } from '../../../../src/domain/model/pricing/calendar-date.vo';
import { StayRange } from '../../../../src/domain/model/pricing/stay-range';

const range = (checkIn: string, checkOut: string): StayRange =>
  StayRange.of(CalendarDate.of(checkIn), CalendarDate.of(checkOut));

const nightsOf = (stay: StayRange): string[] => stay.nights().map((night) => night.toString());

describe('StayRange', () => {
  it('splits the stay into nights with an exclusive check-out date', () => {
    const stay = range('2026-12-23', '2026-12-26');

    expect(stay.nightCount).toBe(3);
    expect(nightsOf(stay)).toEqual(['2026-12-23', '2026-12-24', '2026-12-25']);
  });

  it('crosses month, year and leap day boundaries', () => {
    expect(nightsOf(range('2026-12-30', '2027-01-02'))).toEqual([
      '2026-12-30',
      '2026-12-31',
      '2027-01-01',
    ]);
    expect(nightsOf(range('2028-02-28', '2028-03-01'))).toEqual(['2028-02-28', '2028-02-29']);
  });

  it('accepts a one night stay', () => {
    expect(nightsOf(range('2026-12-24', '2026-12-25'))).toEqual(['2026-12-24']);
  });

  it.each([
    ['2026-12-24', '2026-12-24'],
    ['2026-12-26', '2026-12-23'],
  ])('rejects check-in %s with check-out %s (FR-008)', (checkIn, checkOut) => {
    expect(() => range(checkIn, checkOut)).toThrow(InvalidDateRangeError);
  });

  it('uses INVALID_DATE_RANGE as error code', () => {
    expect(new InvalidDateRangeError().errorCode).toBe('INVALID_DATE_RANGE');
  });

  it('treats a single date as checkOutDate = date + 1 day', () => {
    const stay = StayRange.singleNight(CalendarDate.of('2026-12-31'));

    expect(stay.checkInDate.toString()).toBe('2026-12-31');
    expect(stay.checkOutDate.toString()).toBe('2027-01-01');
    expect(nightsOf(stay)).toEqual(['2026-12-31']);
  });
});
