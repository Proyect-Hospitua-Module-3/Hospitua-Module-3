import { InvalidBaseRateError } from '../../../../src/domain/errors/pricing/invalid-base-rate.error';
import { BaseRate } from '../../../../src/domain/model/pricing/base-rate';

describe('BaseRate', () => {
  it('accepts a positive decimal text amount in COP at scale 2', () => {
    const rate = BaseRate.create('250000.00');

    expect(rate.amount.toString()).toBe('250000.00');
    expect(rate.currency).toBe('COP');
  });

  it.each(['0', '0.00', '-1.00'])('rejects non-positive amount %s', (amount) => {
    expect(() => BaseRate.create(amount)).toThrow(InvalidBaseRateError);
  });

  it.each(['+250000', '+0.01'])('rejects plus-signed amount %s', (amount) => {
    expect(() => BaseRate.create(amount)).toThrow(InvalidBaseRateError);
  });

  it('rejects amounts with more than two decimal places instead of rounding them', () => {
    expect(() => BaseRate.create('1.005')).toThrow(InvalidBaseRateError);
  });

  it.each([
    ['250000.5', '250000.50'],
    ['250000.500', '250000.50'],
    ['0.01', '0.01'],
  ])('accepts %s and normalises it to %s', (input, expected) => {
    expect(BaseRate.create(input).amount.toString()).toBe(expected);
  });

  it.each(['abc', '1e5', '', ' 1', '1.', '.5'])('rejects malformed text %s', (amount) => {
    expect(() => BaseRate.create(amount)).toThrow(InvalidBaseRateError);
  });

  it('rejects non-string input', () => {
    expect(() => BaseRate.create(250000)).toThrow(InvalidBaseRateError);
    expect(() => BaseRate.create(null)).toThrow(InvalidBaseRateError);
  });
});
