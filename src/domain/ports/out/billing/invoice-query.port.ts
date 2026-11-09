// Feature 008 · Gestionar facturación
import { CustomerNameCriterion } from '../../../model/billing/invoice-search-criteria';
import {
  ChannelTotals,
  InvoiceDetail,
  InvoiceSearchPage,
} from '../../../model/billing/invoice-read-models';
import { IssuedInterval } from '../../../model/billing/issued-date-range';
import { ChannelKind } from '../../../model/shared/channel.vo';

export const INVOICE_QUERY = Symbol('InvoiceQueryPort');

// Filtro de la búsqueda con el rango ya convertido a instantes en la zona de referencia.
export interface InvoiceSearchFilter {
  readonly stayId?: string;
  readonly reservationRef?: string;
  readonly customerName?: CustomerNameCriterion;
  readonly customerTaxId?: string;
  readonly channel?: ChannelKind;
  readonly otaId?: string;
  readonly issued?: IssuedInterval;
  // Foto de la búsqueda: solo facturas con issuedAt <= asOf (NFR-002).
  readonly asOf: Date;
}

export interface InvoicePageRequest {
  readonly page: number;
  readonly pageSize: number;
}

// Lectura de la tabla invoice para 008. Solo métodos de consulta: este puerto no puede
// escribir, así que 008 no puede modificar facturas (FR-006, BR-001). El adaptador usa
// transacciones READ ONLY y no reutiliza el repositorio de escritura de 006.
export interface InvoiceQueryPort {
  // Corte con clock_timestamp(), después de esperar las emisiones que aún no confirmaron.
  // Ninguna factura de 006 anterior al corte puede hacerse visible en una página posterior.
  currentTime(): Promise<Date>;
  // Una página ordenada por issuedAt y número oficial descendentes, y el total de coincidencias.
  search(filter: InvoiceSearchFilter, page: InvoicePageRequest): Promise<InvoiceSearchPage>;
  // Sin factura con ese id → null.
  findDetailById(invoiceId: string): Promise<InvoiceDetail | null>;
  // Totales de los canales con al menos una factura en el intervalo; uno por (channel, otaId).
  summarizeByChannel(interval: IssuedInterval): Promise<ChannelTotals[]>;
  // Toda OTA con al menos una factura histórica, para mostrarla en cero (FR-014).
  listKnownOtaIds(): Promise<string[]>;
}
