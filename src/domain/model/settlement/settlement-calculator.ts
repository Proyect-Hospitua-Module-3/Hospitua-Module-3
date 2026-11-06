// Feature 007 · Generar liquidación
import Decimal from 'decimal.js';
import { LodgingQuote } from '../pricing/lodging-quote';
import { Channel } from '../shared/channel.vo';
import { Money } from '../shared/money.vo';
import { CommissionPercentage } from './commission-percentage.vo';

const ONE_HUNDRED = new Decimal(100);

export interface SettlementCalculationInput {
  quote: LodgingQuote;
  channel: Channel;
  // Obligatoria con canal OTA; null en canal directo.
  commission: CommissionPercentage | null;
}

export interface SettlementBreakdown {
  readonly currency: string;
  readonly lodgingAmount: Money;
  readonly baseLodgingAmount: Money;
  readonly dynamicAdjustmentAmount: Money;
  readonly otaCommissionAmount: Money;
  readonly netIncome: Money;
}

// Servicio de dominio puro: cotización guardada + canal → desglose de la liquidación.
// Sin puertos ni IO, para que 002 lo reutilice en la liquidación informativa.
//
// Nunca recalcula la tarifa dinámica (FR-002, BR-004): el hospedaje es el de la cotización
// y el ajuste dinámico solo resta valores ya guardados. El IVA no entra (FR-013): lo
// agrega 006 al facturar.
export class SettlementCalculator {
  static calculate({
    quote,
    channel,
    commission,
  }: SettlementCalculationInput): SettlementBreakdown {
    if (channel.isOta !== (commission !== null)) {
      // Error de programación: channelTermsOf siempre entrega los dos juntos.
      throw new Error('La comisión es obligatoria con canal OTA y no aplica en canal directo.');
    }

    const lodgingAmount = Money.of(quote.lodgingAmount);
    // Parte de tarifa base y ajuste de la tarifa dinámica (puede ser negativo). Informativos:
    // no cambian la comisión ni el ingreso neto (FR-012).
    const baseLodgingAmount = quote.nights.reduce(
      (total, night) => total.add(Money.of(night.baseRate)),
      Money.zero(),
    );
    const dynamicAdjustmentAmount = lodgingAmount.subtract(baseLodgingAmount);

    // OTA: hospedaje × porcentaje / 100, half-up a 2 decimales una sola vez (FR-006).
    // Directo: sin comisión (FR-007).
    const otaCommissionAmount = commission
      ? lodgingAmount.multiply(commission.toDecimal().dividedBy(ONE_HUNDRED))
      : Money.zero();

    return {
      currency: quote.currency,
      lodgingAmount,
      baseLodgingAmount,
      dynamicAdjustmentAmount,
      otaCommissionAmount,
      // FR-008: hospedaje menos comisión, sin IVA.
      netIncome: lodgingAmount.subtract(otaCommissionAmount),
    };
  }
}
