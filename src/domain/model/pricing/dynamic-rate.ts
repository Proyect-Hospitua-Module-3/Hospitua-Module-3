// Feature 005 · Consultar tarifa dinámica
import { Money } from '../shared/money.vo';
import { BaseRate } from './base-rate';
import { CalendarDate } from './calendar-date.vo';
import { calculateDynamicRate } from './calculate-dynamic-rate';
import { SeasonAdjustmentPercent } from './season-adjustment-percent.vo';

export interface DynamicRateInput {
  date: CalendarDate;
  baseRate: BaseRate;
  seasonName: string;
  adjustmentPercent: SeasonAdjustmentPercent;
}

// Tarifa de una noche: la tarifa base de Módulo 1 (004) ajustada por la temporada vigente
// de esa fecha. Guarda de dónde sale el valor para poder trazarlo (FR-009, NFR-004).
// No se persiste (FR-007); la cotización copia estos mismos datos por noche.
export class DynamicRate {
  private constructor(
    readonly date: CalendarDate,
    readonly baseRate: Money,
    readonly seasonName: string,
    readonly adjustmentPercent: SeasonAdjustmentPercent,
    readonly dynamicRate: Money,
  ) {
    Object.freeze(this);
  }

  static compute(input: DynamicRateInput): DynamicRate {
    const baseRate = input.baseRate.amount;
    return new DynamicRate(
      input.date,
      baseRate,
      input.seasonName,
      input.adjustmentPercent,
      calculateDynamicRate(baseRate, input.adjustmentPercent),
    );
  }
}
