// Feature 008 · Gestionar facturación. Consultas de solo lectura.
import { apiRequest } from './http';

export type InvoiceChannel = 'DIRECT' | 'OTA';
export type CustomerMatchMode = 'EXACT' | 'PARTIAL';

export interface InvoiceSearchQuery {
  stayId?: string;
  reservationRef?: string;
  customerName?: string;
  customerMatch?: CustomerMatchMode;
  customerTaxId?: string;
  channel?: InvoiceChannel;
  otaId?: string;
  issuedFrom?: string;
  issuedTo?: string;
  page?: number;
  pageSize?: number;
  asOf?: string;
}

export interface InvoiceSearchItem {
  invoiceId: string;
  invoiceNumber: number;
  issuedAt: string;
  stayId: string;
  reservationRef: string;
  channel: InvoiceChannel;
  otaId: string | null;
  customerName: string;
  customerTaxId: string;
  currency: string;
  totalAmount: string;
}

export interface InvoiceSearchResult {
  items: InvoiceSearchItem[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
  asOf: string;
  resultStatus: 'MATCHES' | 'NO_MATCHES';
  customerMatchMode: CustomerMatchMode | null;
}

export interface InvoiceDetail {
  invoiceId: string;
  invoiceNumber: number;
  status: 'ISSUED';
  immutable: true;
  issuedAt: string;
  settlementId: string;
  stayId: string;
  reservationRef: string;
  channel: InvoiceChannel;
  otaId: string | null;
  customer: { name: string; taxId: string };
  currency: string;
  lodgingAmount: string;
  otaCommissionAmount: string;
  netIncome: string;
  vatRateApplied: string;
  vatAmount: string;
  totalAmount: string;
}

export interface InvoiceSummaryRange {
  issuedFrom: string;
  issuedTo: string;
}

export interface InvoiceChannelTotals {
  channel: InvoiceChannel;
  otaId: string | null;
  invoiceCount: number;
  totalLodging: string;
  totalOtaCommission: string;
  totalVat: string;
  totalInvoiced: string;
}

export interface InvoiceChannelSummary {
  range: InvoiceSummaryRange;
  timezone: string;
  currency: string;
  channels: InvoiceChannelTotals[];
}

// Lista blanca: solo se transmiten los parámetros del contrato.
export function searchInvoices(
  token: string,
  query: InvoiceSearchQuery,
): Promise<InvoiceSearchResult> {
  const params = new URLSearchParams();
  const fields: (keyof InvoiceSearchQuery)[] = [
    'stayId',
    'reservationRef',
    'customerName',
    'customerMatch',
    'customerTaxId',
    'channel',
    'otaId',
    'issuedFrom',
    'issuedTo',
    'page',
    'pageSize',
    'asOf',
  ];
  for (const field of fields) {
    const value = query[field];
    if (value !== undefined) params.set(field, String(value));
  }
  return apiRequest<InvoiceSearchResult>(`/invoices?${params.toString()}`, { token });
}

export function getInvoiceDetail(token: string, invoiceId: string): Promise<InvoiceDetail> {
  return apiRequest<InvoiceDetail>(`/invoices/${encodeURIComponent(invoiceId)}`, { token });
}

export function getInvoicesSummary(
  token: string,
  range: InvoiceSummaryRange,
): Promise<InvoiceChannelSummary> {
  const params = new URLSearchParams({ issuedFrom: range.issuedFrom, issuedTo: range.issuedTo });
  return apiRequest<InvoiceChannelSummary>(`/invoices/summary?${params.toString()}`, { token });
}
