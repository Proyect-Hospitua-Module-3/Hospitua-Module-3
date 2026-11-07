// Feature 006 · Generar factura final
import { Invoice as InvoiceRow, Prisma } from '@prisma/client';
import { BillingCustomer } from '../../../../../../domain/model/billing/billing-customer';
import {
  Invoice,
  INVOICE_STATUS,
  InvoiceDraft,
} from '../../../../../../domain/model/billing/invoice';
import { ChannelKind } from '../../../../../../domain/model/shared/channel.vo';

export type { InvoiceRow };

// Los importes viajan como texto decimal; el número oficial, como bigint en la base y como
// entero en el dominio (un bigint de PostgreSQL cabe de sobra en un entero seguro de JS
// para cualquier cantidad realista de facturas; Invoice lo verifica).
export class InvoiceMapper {
  static toCreateInput(
    draft: InvoiceDraft,
    invoiceNumber: bigint,
  ): Prisma.InvoiceUncheckedCreateInput {
    return {
      id: draft.invoiceId,
      invoiceNumber,
      status: INVOICE_STATUS,
      settlementId: draft.settlementId,
      stayId: draft.stayId,
      sourceEventId: draft.sourceEventId,
      reservationRef: draft.reservationRef,
      channel: draft.channel,
      otaId: draft.otaId,
      customerName: draft.customer.name,
      customerTaxId: draft.customer.taxId,
      currency: draft.currency,
      lodgingAmount: draft.lodgingAmount,
      otaCommissionAmount: draft.otaCommissionAmount,
      netIncome: draft.netIncome,
      vatRateApplied: draft.vatRateApplied,
      vatAmount: draft.vatAmount,
      totalAmount: draft.totalAmount,
      // issued_at no se envía: lo pone la base de datos con clock_timestamp() (FR-012).
    };
  }

  static toDomain(row: InvoiceRow): Invoice {
    return Invoice.restore({
      invoiceId: row.id,
      invoiceNumber: Number(row.invoiceNumber),
      issuedAt: row.issuedAt,
      settlementId: row.settlementId,
      stayId: row.stayId,
      sourceEventId: row.sourceEventId,
      reservationRef: row.reservationRef,
      // Un CHECK de la migración garantiza que solo hay DIRECT u OTA.
      channel: row.channel as ChannelKind,
      otaId: row.otaId,
      customer: BillingCustomer.restore(row.customerName, row.customerTaxId),
      currency: row.currency,
      lodgingAmount: row.lodgingAmount.toFixed(2),
      otaCommissionAmount: row.otaCommissionAmount.toFixed(2),
      netIncome: row.netIncome.toFixed(2),
      vatRateApplied: row.vatRateApplied.toFixed(2),
      vatAmount: row.vatAmount.toFixed(2),
      totalAmount: row.totalAmount.toFixed(2),
    });
  }
}
