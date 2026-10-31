// Feature 001 · Actualizar porcentaje de IVA
import Decimal from 'decimal.js';
import { InvalidVatRateError } from '../../errors/billing/invalid-vat-rate.error';

export const VAT_RATE_MIN = new Decimal(0);
export const VAT_RATE_MAX = new Decimal(100);

// Solo dígitos y, opcionalmente, hasta 2 decimales: excluye negativos, notación
// científica, espacios y cualquier valor que se redondearía en silencio (19.555).
const VAT_RATE_FORMAT = /^\d+(\.\d{1,2})?$/;

// Porcentaje de IVA como decimal exacto entre 0 y 100, ambos inclusive (FR-002, NFR-004).
export class VatRateValue {
  private constructor(private readonly amount: Decimal) {}

  // Recibe el valor tal como llega (texto). Un número JSON se rechaza: el contrato
  // exige string decimal para no pasar por coma flotante.
  static of(raw: unknown): VatRateValue {
    if (typeof raw !== 'string' || !VAT_RATE_FORMAT.test(raw)) {
      throw new InvalidVatRateError();
    }
    const amount = new Decimal(raw);
    if (amount.lessThan(VAT_RATE_MIN) || amount.greaterThan(VAT_RATE_MAX)) {
      throw new InvalidVatRateError();
    }
    return new VatRateValue(amount);
  }

  toDecimal(): Decimal {
    return this.amount;
  }

  // Siempre con 2 decimales: "19.00".
  toString(): string {
    return this.amount.toFixed(2);
  }

  equals(other: VatRateValue): boolean {
    return this.amount.equals(other.amount);
  }
}
