// Feature 009 · Modificar precio tarifa según temporada
import { SeasonAdjustmentPercent } from './season-adjustment-percent.vo';

// Versión del ajuste de una temporada. Es inmutable: un cambio de ajuste cierra esta
// versión y crea otra que empieza en el mismo instante (FR-003, BR-004).
export class SeasonRule {
  constructor(
    readonly adjustmentPercent: SeasonAdjustmentPercent,
    readonly validFrom: Date,
  ) {}
}
