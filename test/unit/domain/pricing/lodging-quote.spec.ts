// Feature 005 · Consultar tarifa dinámica (T006)
import { BaseRate } from '../../../../src/domain/model/pricing/base-rate';
import { CalendarDate } from '../../../../src/domain/model/pricing/calendar-date.vo';
import { DynamicRate } from '../../../../src/domain/model/pricing/dynamic-rate';
import { LodgingQuote } from '../../../../src/domain/model/pricing/lodging-quote';
import { SeasonAdjustmentPercent } from '../../../../src/domain/model/pricing/season-adjustment-percent.vo';
import { StayRange } from '../../../../src/domain/model/pricing/stay-range';

const QUOTE_ID = 'a1f2c3d4-e5b6-4789-8a9b-0c1d2e3f4a5b';
const ROOM_ID = '3f2b8c1e-5a47-4d09-9b6e-1c2d3e4f5a6b';

const night = (date: string, seasonName: string, adjustment: string): DynamicRate =>
  DynamicRate.compute({
    date: CalendarDate.of(date),
    baseRate: BaseRate.create('300000.00'),
    seasonName,
    adjustmentPercent: SeasonAdjustmentPercent.of(adjustment),
  });

const stay = StayRange.of(CalendarDate.of('2026-12-23'), CalendarDate.of('2026-12-26'));

const nights = [
  night('2026-12-23', 'Regular', '0.00'),
  night('2026-12-24', 'Alta', '20.00'),
  night('2026-12-25', 'Alta', '20.00'),
];

describe('LodgingQuote', () => {
  it('builds the quote of the contract example, with the exact sum of the nights', () => {
    const quote = LodgingQuote.create({ quoteId: QUOTE_ID, roomId: ROOM_ID, stay, nights });

    expect({ ...quote }).toEqual({
      quoteId: QUOTE_ID,
      roomId: ROOM_ID,
      checkInDate: '2026-12-23',
      checkOutDate: '2026-12-26',
      currency: 'COP',
      lodgingAmount: '1020000.00',
      nights: [
        {
          date: '2026-12-23',
          baseRate: '300000.00',
          seasonName: 'Regular',
          adjustmentPercent: '0.00',
          rate: '300000.00',
        },
        {
          date: '2026-12-24',
          baseRate: '300000.00',
          seasonName: 'Alta',
          adjustmentPercent: '20.00',
          rate: '360000.00',
        },
        {
          date: '2026-12-25',
          baseRate: '300000.00',
          seasonName: 'Alta',
          adjustmentPercent: '20.00',
          rate: '360000.00',
        },
      ],
    });
  });

  it('sums the rounded night rates, without floating point errors', () => {
    const roundedNight = (date: string): DynamicRate =>
      DynamicRate.compute({
        date: CalendarDate.of(date),
        baseRate: BaseRate.create('10.10'),
        seasonName: 'Alta',
        adjustmentPercent: SeasonAdjustmentPercent.of('5.00'),
      });
    const twoNights = StayRange.of(CalendarDate.of('2026-12-23'), CalendarDate.of('2026-12-25'));

    const quote = LodgingQuote.create({
      quoteId: QUOTE_ID,
      roomId: ROOM_ID,
      stay: twoNights,
      nights: [roundedNight('2026-12-23'), roundedNight('2026-12-24')],
    });

    expect(quote.lodgingAmount).toBe('21.22');
  });

  it('is immutable (BR-006)', () => {
    const quote = LodgingQuote.create({ quoteId: QUOTE_ID, roomId: ROOM_ID, stay, nights });

    expect(Object.isFrozen(quote)).toBe(true);
    expect(Object.isFrozen(quote.nights)).toBe(true);
    expect(quote.nights.every((n) => Object.isFrozen(n))).toBe(true);
  });

  it.each([
    ['a missing night', nights.slice(0, 2)],
    ['nights out of order', [nights[1], nights[0], nights[2]]],
    ['a night outside the stay', [...nights.slice(0, 2), night('2026-12-26', 'Alta', '20.00')]],
  ])('rejects %s', (_, wrongNights) => {
    expect(() =>
      LodgingQuote.create({ quoteId: QUOTE_ID, roomId: ROOM_ID, stay, nights: wrongNights }),
    ).toThrow('Las noches de la cotización no coinciden');
  });

  it('restores a stored quote exactly as it was saved, without recalculating (FR-013)', () => {
    const stored = {
      quoteId: QUOTE_ID,
      roomId: ROOM_ID,
      checkInDate: '2026-12-24',
      checkOutDate: '2026-12-25',
      currency: 'COP',
      // Valor guardado con una regla anterior: no se recalcula con la vigente.
      lodgingAmount: '345000.00',
      nights: [
        {
          date: '2026-12-24',
          baseRate: '300000.00',
          seasonName: 'Alta',
          adjustmentPercent: '15.00',
          rate: '345000.00',
        },
      ],
    };

    const quote = LodgingQuote.restore(stored);

    expect({ ...quote }).toEqual(stored);
    expect(Object.isFrozen(quote.nights[0])).toBe(true);
    expect(quote.nights[0]).not.toBe(stored.nights[0]);
  });
});
