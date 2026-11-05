// Feature 004 · Consultar tarifa base
import Decimal from 'decimal.js';
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

  // 005 · Consultar tarifa dinámica
  it('adds exactly, without floating point errors', () => {
    expect(Money.of('0.10').add(Money.of('0.20')).toString()).toBe('0.30');
    expect(Money.zero().add(Money.of('360000.00')).toString()).toBe('360000.00');
  });

  it.each([
    ['10.10', '1.05', '10.61'],
    ['300000.00', '1.2', '360000.00'],
    ['300000.00', '0', '0.00'],
  ])('multiplies %s by %s rounding half-up once at scale 2 → %s', (amount, factor, expected) => {
    expect(Money.of(amount).multiply(new Decimal(factor)).toString()).toBe(expected);
  });
});
