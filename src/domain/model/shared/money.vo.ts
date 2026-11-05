// Feature 004 · Consultar tarifa base (005 agrega zero, add y multiply)
import Decimal from 'decimal.js';

const MONEY_SCALE = 2;
const ZERO_AMOUNT = new Decimal(0);
const MONEY_FORMAT = /^[+-]?\d+(\.\d+)?$/;

// Importe decimal genérico. Las reglas de negocio, como que sea positivo, corresponden
// al value object que usa el importe (por ejemplo, BaseRate).
export class Money {
  private constructor(private readonly value: Decimal) {}

  static of(raw: unknown): Money {
    if (typeof raw !== 'string' || !MONEY_FORMAT.test(raw)) {
      throw new TypeError('El importe debe ser texto decimal válido.');
    }
    return new Money(new Decimal(raw).toDecimalPlaces(MONEY_SCALE, Decimal.ROUND_HALF_UP));
  }

  static zero(): Money {
    return new Money(ZERO_AMOUNT);
  }

  // Suma exacta: los dos importes ya tienen 2 decimales, no hace falta redondear.
  add(other: Money): Money {
    return new Money(this.value.plus(other.value));
  }

  // Multiplica por un factor exacto y redondea half-up a 2 decimales una sola vez,
  // al final (005: tarifa base × (1 + ajuste / 100)).
  multiply(factor: Decimal): Money {
    return new Money(this.value.times(factor).toDecimalPlaces(MONEY_SCALE, Decimal.ROUND_HALF_UP));
  }

  toString(): string {
    return this.value.toFixed(MONEY_SCALE);
  }

  isPositive(): boolean {
    return this.value.greaterThan(ZERO_AMOUNT);
  }
}
