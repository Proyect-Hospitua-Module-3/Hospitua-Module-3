// Feature 005 · Consultar tarifa dinámica
import Decimal from 'decimal.js';
import { Money } from '../shared/money.vo';
import { SeasonAdjustmentPercent } from './season-adjustment-percent.vo';

const ONE = new Decimal(1);
const ONE_HUNDRED = new Decimal(100);

// dynamicRate = baseRate × (1 + adjustmentPercent / 100), half-up a 2 decimales.
//
// No recibe el nombre de la temporada a propósito: el ajuste sale solo del valor
// configurado en 009, sea Regular, Alta, Baja o cualquier otra (FR-002, BR-007).
// -100.00 deja la noche en cero y +100.00 la duplica.
export function calculateDynamicRate(
  baseRate: Money,
  adjustmentPercent: SeasonAdjustmentPercent,
): Money {
  const factor = ONE.plus(adjustmentPercent.toDecimal().dividedBy(ONE_HUNDRED));
  return baseRate.multiply(factor);
}
