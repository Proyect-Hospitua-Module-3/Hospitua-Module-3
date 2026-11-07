// Feature 006 · Generar factura final
import Decimal from 'decimal.js';
import { Money } from '../shared/money.vo';
import { VatRateValue } from './vat-rate-value.vo';

const ONE_HUNDRED = new Decimal(100);

// Lo que la factura toma de la liquidación Final (007), sin recalcularlo (FR-003).
export interface SettlementAmounts {
  readonly currency: string;
  readonly lodgingAmount: string;
  readonly otaCommissionAmount: string;
  readonly netIncome: string;
}

// Desglose congelado al emitir. Importes y tasa como texto decimal exacto; nunca number.
export interface InvoiceAmounts extends SettlementAmounts {
  readonly vatRateApplied: string;
  readonly vatAmount: string;
  readonly totalAmount: string;
}

// Servicio de dominio puro: liquidación + IVA vigente → desglose de la factura.
//   vatAmount   = hospedaje × IVA / 100            half-up a 2 decimales (FR-002)
//   totalAmount = hospedaje + vatAmount           lo que se cobra al huésped (FR-003, BR-002)
// La comisión OTA y el ingreso neto se copian como referencia de conciliación: no se
// suman ni se restan del total (FR-004, FR-010).
export class InvoiceBreakdown {
  static calculate(settlement: SettlementAmounts, vatRate: VatRateValue): InvoiceAmounts {
    const lodging = Money.of(settlement.lodgingAmount);
    const vatAmount = lodging.multiply(vatRate.toDecimal().dividedBy(ONE_HUNDRED));
    return InvoiceBreakdown.verified({
      currency: settlement.currency,
      lodgingAmount: lodging.toString(),
      otaCommissionAmount: Money.of(settlement.otaCommissionAmount).toString(),
      netIncome: Money.of(settlement.netIncome).toString(),
      vatRateApplied: vatRate.toString(),
      vatAmount: vatAmount.toString(),
      totalAmount: lodging.add(vatAmount).toString(),
    });
  }

  // Comprueba las dos relaciones de FR-010 y que nada sea negativo. Si no se cumplen es un
  // error de integridad (la liquidación o la fila guardada están mal), no del llamador.
  static verified(amounts: InvoiceAmounts): InvoiceAmounts {
    const lodging = Money.of(amounts.lodgingAmount);
    const commission = Money.of(amounts.otaCommissionAmount);
    const net = Money.of(amounts.netIncome);
    const vat = Money.of(amounts.vatAmount);
    const total = Money.of(amounts.totalAmount);
    VatRateValue.of(amounts.vatRateApplied);

    if (amounts.currency !== 'COP') {
      throw new Error(`Moneda de factura no soportada: ${amounts.currency}.`);
    }
    if ([lodging, commission, net, vat, total].some((amount) => amount.isNegative())) {
      throw new Error('Los importes de la factura no pueden ser negativos.');
    }
    if (!lodging.add(vat).equals(total)) {
      throw new Error('El total de la factura debe ser hospedaje + IVA.');
    }
    if (!lodging.subtract(commission).equals(net)) {
      throw new Error('El ingreso neto debe ser hospedaje − comisión OTA.');
    }
    return Object.freeze({ ...amounts });
  }
}
