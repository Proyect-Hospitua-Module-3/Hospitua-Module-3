// Feature 002 · Consultar liquidación
import { InvoiceSummary } from '../../../model/settlement/settlement-query-result';

export const SETTLEMENT_INVOICE_QUERY = Symbol('SettlementInvoiceQueryPort');

// Lectura de la factura que 006 emitió para una liquidación (FR-003). Solo lectura: el
// adaptador lee la tabla invoice con una transacción READ ONLY, sin usar código de billing.
export interface SettlementInvoiceQueryPort {
  // A lo sumo una factura por liquidación (UNIQUE(invoice.settlement_id)). Sin factura
  // emitida → null.
  findBySettlementId(settlementId: string): Promise<InvoiceSummary | null>;
}
