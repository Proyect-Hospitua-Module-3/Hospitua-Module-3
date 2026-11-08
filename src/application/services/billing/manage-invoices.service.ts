// Feature 008 · Gestionar facturación
import { InvalidInvoiceQueryError } from '../../../domain/errors/billing/invalid-invoice-query.error';
import { InvoiceNotFoundError } from '../../../domain/errors/billing/invoice-not-found.error';
import {
  InvoiceSearchQuery,
  InvoiceSummaryQuery,
  parseInvoiceId,
  parseInvoiceSearch,
  parseInvoiceSummaryRange,
} from '../../../domain/model/billing/invoice-search-criteria';
import {
  ChannelTotals,
  InvoiceChannelSummary,
  InvoiceDetail,
  InvoiceSearchResult,
} from '../../../domain/model/billing/invoice-read-models';
import { issuedIntervalOf } from '../../../domain/model/billing/issued-date-range';
import { ManageInvoicesUseCase } from '../../../domain/ports/in/billing/manage-invoices.use-case';
import { InvoiceQueryPort } from '../../../domain/ports/out/billing/invoice-query.port';

// Toda factura de 006 está en pesos (CHECK invoice_currency_cop).
const INVOICE_CURRENCY = 'COP';
const ZERO = '0.00';

// Búsqueda, detalle y resumen por canal de las facturas emitidas (contratos de 008). Solo
// lee, a través de un puerto sin métodos de escritura (FR-006, BR-001). Los importes son los
// persistidos por 006: aquí solo se agrupan para el resumen, nunca se recalculan (BR-004).
//
// Sin decoradores de NestJS: el wiring está en infrastructure/config/billing.module.ts.
export class ManageInvoicesService implements ManageInvoicesUseCase {
  constructor(
    private readonly invoices: InvoiceQueryPort,
    // Zona de referencia de los filtros por fecha y del resumen (NFR-006), p. ej. America/Bogota.
    private readonly timeZone: string,
  ) {}

  // HU1. Los parámetros se validan antes de tocar la base de datos (FR-002, FR-013). asOf se
  // fija con la hora de la base de datos, el mismo reloj que issued_at, y no puede ser futuro.
  async search(query: InvoiceSearchQuery): Promise<InvoiceSearchResult> {
    const { criteria, page, pageSize, asOf: requestedAsOf } = parseInvoiceSearch(query);
    const now = await this.invoices.currentTime();
    if (requestedAsOf && requestedAsOf.getTime() > now.getTime()) {
      throw new InvalidInvoiceQueryError(
        'asOf no puede ser una fecha futura: reenvía el asOf que devolvió la primera página.',
      );
    }
    const asOf = requestedAsOf ?? now;

    const { issuedRange, ...filters } = criteria;
    const found = await this.invoices.search(
      {
        ...filters,
        issued: issuedRange ? issuedIntervalOf(issuedRange, this.timeZone) : undefined,
        asOf,
      },
      { page, pageSize },
    );
    return {
      items: found.items,
      page,
      pageSize,
      totalItems: found.totalItems,
      totalPages: Math.ceil(found.totalItems / pageSize),
      asOf,
      resultStatus: found.totalItems === 0 ? 'NO_MATCHES' : 'MATCHES',
      customerMatchMode: criteria.customerName?.mode ?? null,
    };
  }

  // HU2: la factura tal como se guardó (FR-004, FR-005, SC-003).
  async getDetail(invoiceId: unknown): Promise<InvoiceDetail> {
    const id = parseInvoiceId(invoiceId);
    const detail = await this.invoices.findDetailById(id);
    if (!detail) {
      throw new InvoiceNotFoundError(id);
    }
    return detail;
  }

  // HU3: un grupo por canal, sin mezclar importes (FR-012). El canal directo aparece siempre y
  // cada OTA con facturas históricas aparece aunque no tenga facturas en el rango (FR-014).
  async summarizeByChannel(query: InvoiceSummaryQuery): Promise<InvoiceChannelSummary> {
    const range = parseInvoiceSummaryRange(query);
    const [totals, knownOtaIds] = await Promise.all([
      this.invoices.summarizeByChannel(issuedIntervalOf(range, this.timeZone)),
      this.invoices.listKnownOtaIds(),
    ]);

    const direct = totals.find((group) => group.channel === 'DIRECT') ?? zeroTotals(null);
    const otaTotals = new Map<string, ChannelTotals>();
    for (const otaId of knownOtaIds) otaTotals.set(otaId, zeroTotals(otaId));
    // Una OTA cuya primera factura se emitió entre las dos lecturas también aparece.
    for (const group of totals) {
      if (group.channel === 'OTA' && group.otaId !== null) otaTotals.set(group.otaId, group);
    }
    const otas = [...otaTotals.values()].sort((a, b) => compareText(a.otaId, b.otaId));

    return {
      range,
      timezone: this.timeZone,
      currency: INVOICE_CURRENCY,
      channels: [direct, ...otas],
    };
  }
}

function zeroTotals(otaId: string | null): ChannelTotals {
  return {
    channel: otaId === null ? 'DIRECT' : 'OTA',
    otaId,
    invoiceCount: 0,
    totalLodging: ZERO,
    totalOtaCommission: ZERO,
    totalVat: ZERO,
    totalInvoiced: ZERO,
  };
}

// Orden alfabético estable por otaId, sin depender del idioma del servidor (NFR-002).
function compareText(a: string | null, b: string | null): number {
  const left = a ?? '';
  const right = b ?? '';
  return left < right ? -1 : left > right ? 1 : 0;
}
