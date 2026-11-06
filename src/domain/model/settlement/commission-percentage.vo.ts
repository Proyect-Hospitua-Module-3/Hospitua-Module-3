// Feature 007 · Generar liquidación
import Decimal from 'decimal.js';

const COMMISSION_MAX = new Decimal(100);

// Sin signo (un negativo se rechaza) y sin notación científica.
const COMMISSION_FORMAT = /^\d+(\.\d+)?$/;

// Porcentaje de comisión pactado con la OTA, de 0 a 100 inclusive, tal como lo informa
// Módulo 2 (FR-005). Se guarda con 2 decimales, igual que la columna numeric(5,2).
export class CommissionPercentage {
  private constructor(private readonly value: Decimal) {
    Object.freeze(this);
  }

  // Módulo 2 lo puede enviar como número JSON o como texto (contrato CLIENT-get-reservation).
  // Devuelve null si no es válido: negativo, mayor a 100, con más de 2 decimales
  // significativos (se redondearía en silencio) o que no es un número. Quien llama decide el
  // error, porque solo él conoce la reserva y la OTA.
  static tryParse(raw: number | string): CommissionPercentage | null {
    if (typeof raw === 'number' && !Number.isFinite(raw)) return null;
    const text = String(raw);
    if (!COMMISSION_FORMAT.test(text)) return null;
    const fraction = text.split('.')[1] ?? '';
    if (fraction.replace(/0+$/, '').length > 2) return null;

    const value = new Decimal(text);
    return value.greaterThan(COMMISSION_MAX) ? null : new CommissionPercentage(value);
  }

  toDecimal(): Decimal {
    return this.value;
  }

  // Siempre con 2 decimales: "15.00".
  toString(): string {
    return this.value.toFixed(2);
  }
}
