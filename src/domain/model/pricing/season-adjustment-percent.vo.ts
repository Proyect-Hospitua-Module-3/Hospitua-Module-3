// Feature 009 · Modificar precio tarifa según temporada
import Decimal from 'decimal.js';
import { InvalidSeasonAdjustmentError } from '../../errors/pricing/invalid-season-adjustment.error';

export const SEASON_ADJUSTMENT_MIN = new Decimal(-100);
export const SEASON_ADJUSTMENT_MAX = new Decimal(100);

// Signo opcional, dígitos y hasta 2 decimales: excluye notación científica, espacios
// y cualquier valor que se redondearía en silencio (12.345).
const ADJUSTMENT_FORMAT = /^[+-]?\d+(\.\d{1,2})?$/;

// Porcentaje firmado que ajusta la tarifa base: +20.00 la sube 20 %, -10.00 la baja 10 %.
// Rango -100..100 inclusive: -100 deja la tarifa en cero y +100 la duplica (plan 009).
export class SeasonAdjustmentPercent {
  private constructor(private readonly amount: Decimal) {}

  // Recibe el valor como texto; un número JSON se rechaza para no pasar por coma flotante.
  static of(raw: unknown): SeasonAdjustmentPercent {
    if (typeof raw !== 'string' || !ADJUSTMENT_FORMAT.test(raw)) {
      throw new InvalidSeasonAdjustmentError();
    }
    const amount = new Decimal(raw);
    if (amount.lessThan(SEASON_ADJUSTMENT_MIN) || amount.greaterThan(SEASON_ADJUSTMENT_MAX)) {
      throw new InvalidSeasonAdjustmentError();
    }
    // "-0" y "0" son el mismo ajuste neutro.
    return new SeasonAdjustmentPercent(amount.isZero() ? new Decimal(0) : amount);
  }

  toDecimal(): Decimal {
    return this.amount;
  }

  // Siempre con 2 decimales y sin "+": "20.00", "-10.00", "0.00".
  toString(): string {
    return this.amount.toFixed(2);
  }

  equals(other: SeasonAdjustmentPercent): boolean {
    return this.amount.equals(other.amount);
  }
}
