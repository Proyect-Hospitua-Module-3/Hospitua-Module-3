// Feature 008 · Gestionar facturación
// Vistas de solo lectura de las facturas emitidas por 006: contratos GET-invoices.md,
// GET-invoices-id.md y GET-invoices-summary.md. Importes y porcentajes como texto decimal
// exacto, tal como se guardaron: nunca se recalculan (BR-004, SC-003). Ninguna lleva datos
// migratorios ni datos personales del huésped (FR-009, NFR-003).
import { ChannelKind } from '../shared/channel.vo';
import { CustomerMatchMode } from './customer-match-mode';
import { IssuedDateRange } from './issued-date-range';

// Una fila de la búsqueda (FR-001, FR-003).
export interface InvoiceSearchItem {
  readonly invoiceId: string;
  readonly invoiceNumber: number;
  readonly issuedAt: Date;
  readonly stayId: string;
  readonly reservationRef: string;
  readonly channel: ChannelKind;
  readonly otaId: string | null;
  readonly customerName: string;
  readonly customerTaxId: string;
  readonly currency: string;
  readonly totalAmount: string;
}

// Una página tal como la devuelve el adaptador: totalItems cuenta todas las páginas (FR-007).
export interface InvoiceSearchPage {
  readonly items: readonly InvoiceSearchItem[];
  readonly totalItems: number;
}

export type InvoiceSearchStatus = 'MATCHES' | 'NO_MATCHES';

export interface InvoiceSearchResult {
  readonly items: readonly InvoiceSearchItem[];
  readonly page: number;
  readonly pageSize: number;
  readonly totalItems: number;
  readonly totalPages: number;
  // Foto usada; el cliente la reenvía para pedir otras páginas (NFR-002).
  readonly asOf: Date;
  // Sin coincidencias no es un error (FR-008).
  readonly resultStatus: InvoiceSearchStatus;
  // null si no se buscó por nombre.
  readonly customerMatchMode: CustomerMatchMode | null;
}

// Detalle completo y trazable de una factura (FR-004, FR-005).
export interface InvoiceDetail {
  readonly invoiceId: string;
  readonly invoiceNumber: number;
  // Toda factura emitida por 006 está en ISSUED y es inmutable.
  readonly status: string;
  readonly issuedAt: Date;
  readonly settlementId: string;
  readonly stayId: string;
  readonly reservationRef: string;
  readonly channel: ChannelKind;
  readonly otaId: string | null;
  readonly customerName: string;
  readonly customerTaxId: string;
  readonly currency: string;
  readonly lodgingAmount: string;
  // "0.00" en canal directo.
  readonly otaCommissionAmount: string;
  readonly netIncome: string;
  readonly vatRateApplied: string;
  readonly vatAmount: string;
  readonly totalAmount: string;
}

// Totales de un canal: el directo o una OTA, nunca mezclados (FR-012).
export interface ChannelTotals {
  readonly channel: ChannelKind;
  // null en el canal directo.
  readonly otaId: string | null;
  readonly invoiceCount: number;
  readonly totalLodging: string;
  readonly totalOtaCommission: string;
  readonly totalVat: string;
  readonly totalInvoiced: string;
}

// Resumen consolidado de un rango (FR-011, FR-014): primero DIRECT y luego cada OTA por otaId.
export interface InvoiceChannelSummary {
  readonly range: IssuedDateRange;
  readonly timezone: string;
  readonly currency: string;
  readonly channels: readonly ChannelTotals[];
}
