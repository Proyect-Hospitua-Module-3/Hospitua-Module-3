// Feature 004 · Consultar tarifa base
import { Money } from '../../../../src/domain/model/shared/money.vo';

describe('Money', () => {
  it.each([
    ['0.005', '0.01'],
    ['2.675', '2.68'],
    ['1.004', '1.00'],
    ['1.005', '1.01'],
  ])('rounds %s to %s using half-up at scale 2', (amount, expected) => {
    expect(Money.of(amount).toString()).toBe(expected);
  });

  it.each(['abc', '1e5', '0x10', 'Infinity', 'NaN', '', ' 1'])('rejects invalid text %s', (raw) => {
    expect(() => Money.of(raw)).toThrow(TypeError);
  });

  it('rejects non-string input', () => {
    expect(() => Money.of(5)).toThrow(TypeError);
    expect(() => Money.of(null)).toThrow(TypeError);
  });
});
