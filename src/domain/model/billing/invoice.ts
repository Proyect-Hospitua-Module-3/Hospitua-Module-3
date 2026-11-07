// Feature 006 · Generar factura final
// Forma pública: contrato UC-generate-final-invoice.md (la consumen 010, 002 y 008).
import { ChannelKind } from '../shared/channel.vo';
import { BillingCustomer } from './billing-customer';
import { InvoiceAmounts, InvoiceBreakdown } from './invoice-breakdown';

export const INVOICE_STATUS = 'ISSUED';

// Lo que se entrega a la persistencia para emitir. Sin número ni fecha de emisión: los
// asigna la base de datos en la misma transacción que guarda la factura (FR-005, FR-011).
export interface InvoiceDraft extends InvoiceAmounts {
  readonly invoiceId: string;
  readonly settlementId: string;
  readonly stayId: string;
  readonly sourceEventId: string;
  readonly reservationRef: string;
  readonly channel: ChannelKind;
  readonly otaId: string | null;
  readonly customer: BillingCustomer;
}

export interface StoredInvoice extends InvoiceDraft {
  readonly invoiceNumber: number;
  readonly issuedAt: Date;
}

// Datos de la liquidación Final que identifican y clasifican la factura.
export interface InvoiceSettlementRef {
  readonly settlementId: string;
  readonly stayId: string;
  readonly reservationRef: string;
  readonly channel: ChannelKind;
  readonly otaId: string | null;
}

export interface PrepareInvoiceInput {
  invoiceId: string;
  sourceEventId: string;
  settlement: InvoiceSettlementRef;
  customer: BillingCustomer;
  amounts: InvoiceAmounts;
}

// Factura fiscal definitiva. Solo existe emitida y no tiene ningún método de modificación:
// una vez guardada nadie cambia sus valores ni su número (FR-006, BR-003).
export class Invoice implements StoredInvoice {
  readonly status = INVOICE_STATUS;
  readonly immutable = true;
  readonly invoiceId: string;
  readonly invoiceNumber: number;
  readonly issuedAt: Date;
  readonly settlementId: string;
  readonly stayId: string;
  readonly sourceEventId: string;
  readonly reservationRef: string;
  readonly channel: ChannelKind;
  readonly otaId: string | null;
  readonly customer: BillingCustomer;
  readonly currency: string;
  readonly lodgingAmount: string;
  readonly otaCommissionAmount: string;
  readonly netIncome: string;
  readonly vatRateApplied: string;
  readonly vatAmount: string;
  readonly totalAmount: string;

  private constructor(stored: StoredInvoice) {
    if (!Number.isSafeInteger(stored.invoiceNumber) || stored.invoiceNumber <= 0) {
      throw new Error(`Número de factura inválido: ${stored.invoiceNumber}.`);
    }
    assertChannelData(stored);
    const amounts = InvoiceBreakdown.verified(stored);

    this.invoiceId = stored.invoiceId;
    this.invoiceNumber = stored.invoiceNumber;
    this.issuedAt = new Date(stored.issuedAt.getTime());
    this.settlementId = stored.settlementId;
    this.stayId = stored.stayId;
    this.sourceEventId = stored.sourceEventId;
    this.reservationRef = stored.reservationRef;
    this.channel = stored.channel;
    this.otaId = stored.otaId;
    this.customer = stored.customer;
    this.currency = amounts.currency;
    this.lodgingAmount = amounts.lodgingAmount;
    this.otaCommissionAmount = amounts.otaCommissionAmount;
    this.netIncome = amounts.netIncome;
    this.vatRateApplied = amounts.vatRateApplied;
    this.vatAmount = amounts.vatAmount;
    this.totalAmount = amounts.totalAmount;
    Object.freeze(this);
  }

  // Arma lo que se va a emitir con la liquidación de origen, el cliente del evento y el
  // desglose ya calculado (FR-010, FR-012, NFR-004).
  static prepare({
    invoiceId,
    sourceEventId,
    settlement,
    customer,
    amounts,
  }: PrepareInvoiceInput): InvoiceDraft {
    const draft: InvoiceDraft = {
      invoiceId,
      settlementId: settlement.settlementId,
      stayId: settlement.stayId,
      sourceEventId,
      reservationRef: settlement.reservationRef,
      channel: settlement.channel,
      otaId: settlement.channel === 'OTA' ? settlement.otaId : null,
      customer,
      ...InvoiceBreakdown.verified(amounts),
    };
    assertChannelData(draft);
    return Object.freeze(draft);
  }

  // Reconstruye una factura guardada tal como está, sin recalcular nada (FR-006, FR-007).
  static restore(stored: StoredInvoice): Invoice {
    return new Invoice(stored);
  }
}

// En canal directo no hay OTA ni comisión; en canal OTA, el identificador es obligatorio.
function assertChannelData(invoice: InvoiceDraft): void {
  if (invoice.channel === 'OTA' && !invoice.otaId) {
    throw new Error('Una factura de canal OTA necesita el identificador de la OTA.');
  }
  if (
    invoice.channel === 'DIRECT' &&
    (invoice.otaId !== null || invoice.otaCommissionAmount !== '0.00')
  ) {
    throw new Error('Una factura de canal directo no tiene OTA ni comisión.');
  }
}
