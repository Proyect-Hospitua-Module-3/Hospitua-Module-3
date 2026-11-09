// Feature 008 · Gestionar facturación
// Doble en memoria de InvoiceQueryPort y facturas de ejemplo (contrato GET-invoices-id.md:
// 750.000 de hospedaje, 15% de comisión y 19% de IVA). Filtra y ordena igual que el adaptador
// de PostgreSQL, para probar el servicio y el contrato HTTP sin base de datos.
import {
  ChannelTotals,
  InvoiceDetail,
  InvoiceSearchPage,
} from '../../../src/domain/model/billing/invoice-read-models';
import { IssuedInterval } from '../../../src/domain/model/billing/issued-date-range';
import {
  InvoicePageRequest,
  InvoiceQueryPort,
  InvoiceSearchFilter,
} from '../../../src/domain/ports/out/billing/invoice-query.port';

export const DB_NOW = new Date('2026-12-31T23:20:00.000Z');

let nextId = 0;
function nextUuid(prefix: string): string {
  nextId += 1;
  return `${prefix}-0000-4000-8000-${String(nextId).padStart(12, '0')}`;
}

// Factura OTA de booking en RES-000123, como el ejemplo del contrato.
export function otaInvoice(overrides: Partial<InvoiceDetail> = {}): InvoiceDetail {
  return {
    invoiceId: nextUuid('7d1c2f0e'),
    invoiceNumber: 1042,
    status: 'ISSUED',
    issuedAt: new Date('2026-12-23T16:05:12.000Z'),
    settlementId: nextUuid('4e2b8c1d'),
    stayId: nextUuid('c3a9e1b2'),
    reservationRef: 'RES-000123',
    channel: 'OTA',
    otaId: 'booking',
    customerName: 'Comercializadora Andina S.A.S.',
    customerTaxId: '900123456-7',
    currency: 'COP',
    lodgingAmount: '750000.00',
    otaCommissionAmount: '112500.00',
    netIncome: '637500.00',
    vatRateApplied: '19.00',
    vatAmount: '142500.00',
    totalAmount: '892500.00',
    ...overrides,
  };
}

// Factura del canal directo: sin OTA ni comisión.
export function directInvoice(overrides: Partial<InvoiceDetail> = {}): InvoiceDetail {
  return otaInvoice({
    channel: 'DIRECT',
    otaId: null,
    reservationRef: 'RES-000200',
    customerName: 'Laura Gómez',
    customerTaxId: '52123456',
    lodgingAmount: '540000.00',
    otaCommissionAmount: '0.00',
    netIncome: '540000.00',
    vatAmount: '102600.00',
    totalAmount: '642600.00',
    ...overrides,
  });
}

export class InMemoryInvoiceQuery implements InvoiceQueryPort {
  invoices: InvoiceDetail[] = [];
  now = DB_NOW;
  searches: { filter: InvoiceSearchFilter; page: InvoicePageRequest }[] = [];
  intervals: IssuedInterval[] = [];
  calls = 0;

  constructor(invoices: InvoiceDetail[] = []) {
    this.invoices = invoices;
  }

  async currentTime(): Promise<Date> {
    this.calls += 1;
    return this.now;
  }

  async search(filter: InvoiceSearchFilter, page: InvoicePageRequest): Promise<InvoiceSearchPage> {
    this.calls += 1;
    this.searches.push({ filter, page });
    const matches = this.invoices
      .filter((invoice) => matchesFilter(invoice, filter))
      .sort(
        (a, b) => b.issuedAt.getTime() - a.issuedAt.getTime() || b.invoiceNumber - a.invoiceNumber,
      );
    const start = (page.page - 1) * page.pageSize;
    return {
      items: matches.slice(start, start + page.pageSize).map((invoice) => ({
        invoiceId: invoice.invoiceId,
        invoiceNumber: invoice.invoiceNumber,
        issuedAt: invoice.issuedAt,
        stayId: invoice.stayId,
        reservationRef: invoice.reservationRef,
        channel: invoice.channel,
        otaId: invoice.otaId,
        customerName: invoice.customerName,
        customerTaxId: invoice.customerTaxId,
        currency: invoice.currency,
        totalAmount: invoice.totalAmount,
      })),
      totalItems: matches.length,
    };
  }

  async findDetailById(invoiceId: string): Promise<InvoiceDetail | null> {
    this.calls += 1;
    return this.invoices.find((invoice) => invoice.invoiceId === invoiceId) ?? null;
  }

  async summarizeByChannel(interval: IssuedInterval): Promise<ChannelTotals[]> {
    this.calls += 1;
    this.intervals.push(interval);
    const groups = new Map<string, InvoiceDetail[]>();
    for (const invoice of this.invoices) {
      const time = invoice.issuedAt.getTime();
      if (time < interval.from.getTime() || time >= interval.before.getTime()) continue;
      const key = `${invoice.channel}|${invoice.otaId ?? ''}`;
      groups.set(key, [...(groups.get(key) ?? []), invoice]);
    }
    return [...groups.values()].map((invoices) => ({
      channel: invoices[0].channel,
      otaId: invoices[0].otaId,
      invoiceCount: invoices.length,
      totalLodging: sum(invoices, 'lodgingAmount'),
      totalOtaCommission: sum(invoices, 'otaCommissionAmount'),
      totalVat: sum(invoices, 'vatAmount'),
      totalInvoiced: sum(invoices, 'totalAmount'),
    }));
  }

  async listKnownOtaIds(): Promise<string[]> {
    this.calls += 1;
    return [
      ...new Set(
        this.invoices.flatMap((invoice) => (invoice.otaId === null ? [] : [invoice.otaId])),
      ),
    ];
  }
}

function matchesFilter(invoice: InvoiceDetail, filter: InvoiceSearchFilter): boolean {
  const time = invoice.issuedAt.getTime();
  if (time > filter.asOf.getTime()) return false;
  if (filter.stayId !== undefined && invoice.stayId !== filter.stayId.toLowerCase()) return false;
  if (filter.reservationRef !== undefined && invoice.reservationRef !== filter.reservationRef) {
    return false;
  }
  if (filter.customerName !== undefined) {
    const name = invoice.customerName.toLowerCase();
    const wanted = filter.customerName.value.toLowerCase();
    if (filter.customerName.mode === 'EXACT' ? name !== wanted : !name.includes(wanted)) {
      return false;
    }
  }
  if (filter.customerTaxId !== undefined && invoice.customerTaxId !== filter.customerTaxId) {
    return false;
  }
  if (filter.channel !== undefined && invoice.channel !== filter.channel) return false;
  if (filter.otaId !== undefined && invoice.otaId !== filter.otaId) return false;
  if (filter.issued !== undefined) {
    if (time < filter.issued.from.getTime() || time >= filter.issued.before.getTime()) return false;
  }
  return true;
}

// Suma en centavos enteros: exacta para los importes de prueba.
function sum(invoices: InvoiceDetail[], field: keyof InvoiceDetail): string {
  const cents = invoices.reduce(
    (total, invoice) => total + Math.round(Number(invoice[field]) * 100),
    0,
  );
  return (cents / 100).toFixed(2);
}
