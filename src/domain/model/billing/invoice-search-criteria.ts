// Feature 008 · Gestionar facturación
// Parámetros de las tres consultas: contratos GET-invoices.md, GET-invoices-id.md y
// GET-invoices-summary.md («Reglas de procesamiento»).
import { InvalidInvoiceQueryError } from '../../errors/billing/invalid-invoice-query.error';
import { MissingSearchCriteriaError } from '../../errors/billing/missing-search-criteria.error';
import { ChannelKind } from '../shared/channel.vo';
import {
  CUSTOMER_MATCH_MODES,
  CustomerMatchMode,
  DEFAULT_CUSTOMER_MATCH_MODE,
  PARTIAL_MATCH_MIN_LENGTH,
} from './customer-match-mode';
import { isIssuedCalendarDate, IssuedDateRange, parseIssuedDateRange } from './issued-date-range';

// Mismo formato de UUID que el resto del proyecto (no exige la versión del RFC).
const UUID_FORMAT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const POSITIVE_INTEGER = /^[1-9]\d*$/;
// ISO 8601 con fecha, hora y zona (Z o ±hh:mm), como el asOf que devuelve la búsqueda.
const ISO_INSTANT =
  /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):[0-5]\d(:[0-5]\d(\.\d{1,9})?)?(Z|[+-]([01]\d|2[0-3]):[0-5]\d)$/;
const CHANNELS: readonly ChannelKind[] = ['DIRECT', 'OTA'];

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;
// Tope de página para que el desplazamiento (page − 1) × pageSize quepa en un entero de 32 bits.
const MAX_PAGE = 10_000_000;

// Llegan tal como vienen en la query: pueden faltar, repetirse o no ser texto.
export interface InvoiceSearchQuery {
  readonly stayId?: unknown;
  readonly reservationRef?: unknown;
  readonly customerName?: unknown;
  readonly customerMatch?: unknown;
  readonly customerTaxId?: unknown;
  readonly channel?: unknown;
  readonly otaId?: unknown;
  readonly issuedFrom?: unknown;
  readonly issuedTo?: unknown;
  readonly page?: unknown;
  readonly pageSize?: unknown;
  readonly asOf?: unknown;
}

export interface InvoiceSummaryQuery {
  readonly issuedFrom?: unknown;
  readonly issuedTo?: unknown;
}

export interface CustomerNameCriterion {
  readonly value: string;
  readonly mode: CustomerMatchMode;
}

// Criterios ya validados (FR-001). Al menos uno está presente (FR-002).
export interface InvoiceSearchCriteria {
  readonly stayId?: string;
  readonly reservationRef?: string;
  readonly customerName?: CustomerNameCriterion;
  readonly customerTaxId?: string;
  readonly channel?: ChannelKind;
  // Solo con channel = OTA.
  readonly otaId?: string;
  readonly issuedRange?: IssuedDateRange;
}

export interface InvoiceSearchRequest {
  readonly criteria: InvoiceSearchCriteria;
  readonly page: number;
  readonly pageSize: number;
  // Solo si el cliente lo reenvía; que no sea futuro lo comprueba el servicio con la hora de
  // la base de datos.
  readonly asOf?: Date;
}

// Valida la búsqueda en este orden: formato de cada parámetro (INVALID_QUERY_PARAMS), rango
// de fechas (INVALID_DATE_RANGE) y, al final, que haya al menos un criterio
// (MISSING_SEARCH_CRITERIA). Todo antes de consultar la base de datos.
export function parseInvoiceSearch(query: InvoiceSearchQuery): InvoiceSearchRequest {
  const stayId = optionalText(query.stayId, 'stayId');
  if (stayId !== undefined && !UUID_FORMAT.test(stayId)) {
    throw new InvalidInvoiceQueryError(
      'stayId debe ser un UUID, por ejemplo c3a9e1b2-5f4d-4e6a-8b7c-1d2e3f4a5b6c.',
    );
  }
  const reservationRef = optionalText(query.reservationRef, 'reservationRef');
  const customerTaxId = optionalText(query.customerTaxId, 'customerTaxId');
  const customerName = customerNameOf(query);
  const channel = channelOf(query.channel);
  const otaId = optionalText(query.otaId, 'otaId');
  if (otaId !== undefined && channel !== 'OTA') {
    throw new InvalidInvoiceQueryError('otaId solo se puede usar junto con channel=OTA.');
  }
  const page = positiveInteger(query.page, 'page', 1, MAX_PAGE);
  const pageSize = positiveInteger(query.pageSize, 'pageSize', DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
  const asOf = asOfOf(query.asOf);
  const issuedRange = parseIssuedDateRange(
    optionalText(query.issuedFrom, 'issuedFrom'),
    optionalText(query.issuedTo, 'issuedTo'),
    false,
  );

  const criteria: InvoiceSearchCriteria = {
    stayId,
    reservationRef,
    customerName,
    customerTaxId,
    channel,
    otaId,
    issuedRange,
  };
  const hasCriterion =
    stayId !== undefined ||
    reservationRef !== undefined ||
    customerName !== undefined ||
    customerTaxId !== undefined ||
    channel !== undefined ||
    issuedRange !== undefined;
  if (!hasCriterion) {
    throw new MissingSearchCriteriaError();
  }
  return { criteria, page, pageSize, asOf };
}

// Resumen consolidado: el rango es obligatorio (FR-011, FR-013).
export function parseInvoiceSummaryRange(query: InvoiceSummaryQuery): IssuedDateRange {
  return parseIssuedDateRange(
    optionalText(query.issuedFrom, 'issuedFrom'),
    optionalText(query.issuedTo, 'issuedTo'),
    true,
  ) as IssuedDateRange;
}

// Detalle: el id debe ser un UUID antes de consultar la base de datos.
export function parseInvoiceId(invoiceId: unknown): string {
  if (typeof invoiceId !== 'string' || !UUID_FORMAT.test(invoiceId)) {
    throw new InvalidInvoiceQueryError(
      'invoiceId debe ser un UUID, por ejemplo 7d1c2f0e-4b8a-4c51-9a3e-2f6b1d9c8e01.',
    );
  }
  return invoiceId.toLowerCase();
}

// undefined si no llegó. Repetido, que no sea texto o vacío → INVALID_QUERY_PARAMS.
function optionalText(raw: unknown, name: string): string | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== 'string') {
    throw new InvalidInvoiceQueryError(`Envía ${name} una sola vez.`);
  }
  if (raw.trim() === '') {
    throw new InvalidInvoiceQueryError(`${name} no puede estar vacío.`);
  }
  return raw;
}

function customerNameOf(query: InvoiceSearchQuery): CustomerNameCriterion | undefined {
  const rawMode = optionalText(query.customerMatch, 'customerMatch');
  if (rawMode !== undefined && !CUSTOMER_MATCH_MODES.includes(rawMode as CustomerMatchMode)) {
    throw new InvalidInvoiceQueryError('customerMatch debe ser EXACT o PARTIAL.');
  }
  const name = optionalText(query.customerName, 'customerName');
  // customerMatch sin customerName no cambia nada: la respuesta informa null.
  if (name === undefined) return undefined;

  const mode = (rawMode as CustomerMatchMode | undefined) ?? DEFAULT_CUSTOMER_MATCH_MODE;
  const value = name.trim();
  if (mode === 'PARTIAL' && value.length < PARTIAL_MATCH_MIN_LENGTH) {
    throw new InvalidInvoiceQueryError(
      `Con customerMatch=PARTIAL, customerName debe tener al menos ${PARTIAL_MATCH_MIN_LENGTH} caracteres.`,
    );
  }
  return { value, mode };
}

function channelOf(raw: unknown): ChannelKind | undefined {
  const channel = optionalText(raw, 'channel');
  if (channel !== undefined && !CHANNELS.includes(channel as ChannelKind)) {
    throw new InvalidInvoiceQueryError('channel debe ser DIRECT u OTA.');
  }
  return channel as ChannelKind | undefined;
}

function positiveInteger(raw: unknown, name: string, fallback: number, max: number): number {
  const text = optionalText(raw, name);
  if (text === undefined) return fallback;
  if (!POSITIVE_INTEGER.test(text) || Number(text) > max) {
    throw new InvalidInvoiceQueryError(`${name} debe ser un entero entre 1 y ${max}.`);
  }
  return Number(text);
}

function asOfOf(raw: unknown): Date | undefined {
  const text = optionalText(raw, 'asOf');
  if (text === undefined) return undefined;
  const match = ISO_INSTANT.exec(text);
  const asOf = new Date(text);
  if (
    !match ||
    !isIssuedCalendarDate(match[1]) ||
    Number.isNaN(asOf.getTime()) ||
    !/^\d{4}-/.test(asOf.toISOString())
  ) {
    throw new InvalidInvoiceQueryError(
      'asOf debe ser una fecha y hora ISO 8601 con zona, la misma que devolvió la búsqueda (por ejemplo 2026-12-31T23:20:00.000Z).',
    );
  }
  return asOf;
}
