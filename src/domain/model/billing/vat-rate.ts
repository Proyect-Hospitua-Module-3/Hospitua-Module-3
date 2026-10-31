// Feature 001 · Actualizar porcentaje de IVA
import { VatRateValue } from './vat-rate-value.vo';

// Porcentaje de IVA vigente: el valor, quién lo registró y cuándo (hora de la base de datos).
export class VatRate {
  constructor(
    readonly value: VatRateValue,
    readonly updatedBy: string,
    readonly updatedAt: Date,
  ) {}
}
