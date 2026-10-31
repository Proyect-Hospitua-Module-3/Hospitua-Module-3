// Feature 001 · Actualizar porcentaje de IVA
import { Prisma } from '@prisma/client';
import { VatRate } from '../../../../../../domain/model/billing/vat-rate';
import { VatRateValue } from '../../../../../../domain/model/billing/vat-rate-value.vo';

export interface VatRateRow {
  value: Prisma.Decimal;
  updated_by: string;
  updated_at: Date;
}

export class VatRateMapper {
  static toDomain(row: VatRateRow): VatRate {
    return new VatRate(VatRateValue.of(row.value.toFixed(2)), row.updated_by, row.updated_at);
  }
}
