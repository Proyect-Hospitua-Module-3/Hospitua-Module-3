// Feature 008 · Gestionar facturación
// Contratos: features/008-gestionar-facturacion/2-technical/contracts/
import {
  InvoiceSearchQuery,
  InvoiceSummaryQuery,
} from '../../../model/billing/invoice-search-criteria';
import {
  InvoiceChannelSummary,
  InvoiceDetail,
  InvoiceSearchResult,
} from '../../../model/billing/invoice-read-models';

export const MANAGE_INVOICES_USE_CASE = Symbol('ManageInvoicesUseCase');

// Consultas del Administrador sobre las facturas emitidas por 006. Solo lectura: no crea,
// modifica, recalcula, anula ni reemite facturas ni liquidaciones (FR-006, BR-001). El
// servicio valida los parámetros tal como llegan. requestedBy (sub del token) solo se usa en
// el log de auditoría de cada consulta (T037).
export interface ManageInvoicesUseCase {
  // HU1: búsqueda paginada por uno o varios criterios (FR-001, FR-002, FR-007, FR-008).
  search(query: InvoiceSearchQuery, requestedBy: string): Promise<InvoiceSearchResult>;
  // HU2: detalle de una factura; si no existe, INVOICE_NOT_FOUND (FR-004, FR-005).
  getDetail(invoiceId: unknown, requestedBy: string): Promise<InvoiceDetail>;
  // HU3: totales por canal de un rango, con ceros en los canales sin facturas (FR-011, FR-014).
  summarizeByChannel(
    query: InvoiceSummaryQuery,
    requestedBy: string,
  ): Promise<InvoiceChannelSummary>;
}
