// Feature 004 · Consultar tarifa base
import Decimal from 'decimal.js';

const MONEY_SCALE = 2;
const ZERO_AMOUNT = new Decimal(0);
const MONEY_FORMAT = /^[+-]?\d+(\.\d+)?$/;

// Generic decimal money value. Business rules such as positivity belong to the
// value object that uses the money (for example, BaseRate).
export class Money {
  private constructor(private readonly value: Decimal) {}

  static of(raw: unknown): Money {
    if (typeof raw !== 'string' || !MONEY_FORMAT.test(raw)) {
      throw new TypeError('El importe debe ser texto decimal válido.');
    }
    return new Money(new Decimal(raw).toDecimalPlaces(MONEY_SCALE, Decimal.ROUND_HALF_UP));
  }

  toString(): string {
    return this.value.toFixed(MONEY_SCALE);
  }

  isPositive(): boolean {
    return this.value.greaterThan(ZERO_AMOUNT);
  }
}
