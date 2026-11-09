// Feature 008 · Validación y presentación de consultas de facturas.
import type { CustomerMatchMode, InvoiceSearchQuery, InvoiceSummaryRange } from '../api/invoices';

export interface InvoiceSearchInput {
  stayId: string;
  reservationRef: string;
  customerName: string;
  customerMatch: CustomerMatchMode;
  customerTaxId: string;
  channel: '' | 'DIRECT' | 'OTA';
  otaId: string;
  issuedFrom: string;
  issuedTo: string;
  pageSize: string;
}

export type InvoiceSearchErrors = Partial<Record<keyof InvoiceSearchInput | 'criteria', string>>;
export type InvoiceRangeErrors = Partial<Record<keyof InvoiceSummaryRange, string>>;

export const EMPTY_INVOICE_SEARCH: InvoiceSearchInput = {
  stayId: '',
  reservationRef: '',
  customerName: '',
  customerMatch: 'EXACT',
  customerTaxId: '',
  channel: '',
  otaId: '',
  issuedFrom: '',
  issuedTo: '',
  pageSize: '20',
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isInvoiceDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number(value.slice(0, 4)) < 1) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function rangeErrors(range: InvoiceSummaryRange, required: boolean): InvoiceRangeErrors {
  const errors: InvoiceRangeErrors = {};
  const { issuedFrom, issuedTo } = range;
  if (!required && !issuedFrom && !issuedTo) return errors;
  if (!issuedFrom) errors.issuedFrom = 'Indica la fecha de inicio del período.';
  else if (!isInvoiceDate(issuedFrom)) errors.issuedFrom = 'Escribe una fecha de inicio válida.';
  if (!issuedTo) errors.issuedTo = 'Indica la fecha de fin del período.';
  else if (!isInvoiceDate(issuedTo)) errors.issuedTo = 'Escribe una fecha de fin válida.';
  if (!Object.keys(errors).length && issuedFrom > issuedTo) {
    errors.issuedTo = 'La fecha de fin no puede ser anterior a la de inicio.';
  }
  return errors;
}

export function parseInvoiceSearchInput(
  input: InvoiceSearchInput,
): { ok: true; query: InvoiceSearchQuery } | { ok: false; errors: InvoiceSearchErrors } {
  const errors: InvoiceSearchErrors = {};
  const query: InvoiceSearchQuery = { page: 1 };
  const stayId = input.stayId.trim();
  if (stayId) {
    if (!UUID.test(stayId)) errors.stayId = 'Escribe un identificador de estancia UUID válido.';
    else query.stayId = stayId;
  }
  for (const field of ['reservationRef', 'customerTaxId'] as const) {
    const value = input[field].trim();
    if (value) query[field] = value;
  }
  const customerName = input.customerName.trim();
  if (input.customerMatch !== 'EXACT' && input.customerMatch !== 'PARTIAL') {
    errors.customerMatch = 'Selecciona coincidencia exacta o parcial.';
  }
  if (customerName) {
    if (input.customerMatch === 'PARTIAL' && customerName.length < 3) {
      errors.customerName = 'La coincidencia parcial requiere al menos 3 caracteres.';
    }
    query.customerName = customerName;
    query.customerMatch = input.customerMatch;
  }
  if (input.channel !== '' && input.channel !== 'DIRECT' && input.channel !== 'OTA') {
    errors.channel = 'Selecciona todos, directo u OTA.';
  } else if (input.channel) query.channel = input.channel;
  const otaId = input.otaId.trim();
  if (otaId && input.channel !== 'OTA')
    errors.otaId = 'Selecciona el canal OTA para filtrar una OTA.';
  else if (otaId) query.otaId = otaId;

  const range = { issuedFrom: input.issuedFrom.trim(), issuedTo: input.issuedTo.trim() };
  Object.assign(errors, rangeErrors(range, false));
  if (range.issuedFrom || range.issuedTo) Object.assign(query, range);
  if (!/^[1-9]\d*$/.test(input.pageSize) || Number(input.pageSize) > 100) {
    errors.pageSize = 'Selecciona entre 1 y 100 facturas por página.';
  } else query.pageSize = Number(input.pageSize);

  if (
    ![
      stayId,
      query.reservationRef,
      customerName,
      query.customerTaxId,
      input.channel,
      range.issuedFrom,
      range.issuedTo,
    ].some(Boolean)
  ) {
    errors.criteria =
      'Indica al menos un criterio de búsqueda: estancia, reserva, cliente, canal o período de emisión.';
  }
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, query };
}

export function parseInvoiceSummaryRange(
  input: InvoiceSummaryRange,
): { ok: true; range: InvoiceSummaryRange } | { ok: false; errors: InvoiceRangeErrors } {
  const range = { issuedFrom: input.issuedFrom.trim(), issuedTo: input.issuedTo.trim() };
  const errors = rangeErrors(range, true);
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, range };
}

// Los importes viajan como texto decimal. Formatearlos sin Number conserva todos
// los centavos incluso por encima de Number.MAX_SAFE_INTEGER.
export function formatInvoiceMoney(value: string, currency = 'COP'): string {
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(value);
  if (!match) return `${value} ${currency}`;
  const [, sign, whole, decimals = ''] = match;
  const integer = whole.replace(/^0+(?=\d)/, '').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${sign}$\u00a0${integer},${decimals.padEnd(2, '0')}\u00a0${currency}`;
}

export function invoiceChannelLabel(channel: 'DIRECT' | 'OTA', otaId: string | null): string {
  return channel === 'DIRECT' ? 'Directo' : `OTA · ${otaId ?? 'Sin identificador'}`;
}
