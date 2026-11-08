// Feature 008 · Gestionar facturación
import { Logger } from '@nestjs/common';
import {
  InvoiceSearchQuery,
  InvoiceSummaryQuery,
} from '../../../domain/model/billing/invoice-search-criteria';
import {
  InvoiceChannelSummary,
  InvoiceDetail,
  InvoiceSearchResult,
} from '../../../domain/model/billing/invoice-read-models';
import { ManageInvoicesUseCase } from '../../../domain/ports/in/billing/manage-invoices.use-case';

// Criterios que cuentan para la búsqueda (FR-001); se registra cuáles llegaron, no su valor.
const SEARCH_CRITERIA = [
  'stayId',
  'reservationRef',
  'customerName',
  'customerTaxId',
  'channel',
  'otaId',
  'issuedFrom',
  'issuedTo',
] as const;

// Envuelve el caso de uso para dejar un log estructurado de cada consulta (T037): quién
// consultó, qué criterios usó, cuántos resultados hubo o el errorCode, y la duración. Nunca
// registra el nombre ni el documento del cliente (NFR-003). Vive en infraestructura para que
// el servicio de aplicación no dependa de NestJS.
export class LoggedManageInvoicesUseCase implements ManageInvoicesUseCase {
  private readonly logger = new Logger('ManageInvoices');

  constructor(
    private readonly inner: ManageInvoicesUseCase,
    private readonly now: () => number = Date.now,
  ) {}

  search(query: InvoiceSearchQuery, requestedBy: string): Promise<InvoiceSearchResult> {
    const criteria = SEARCH_CRITERIA.filter((name) => query[name] !== undefined);
    return this.logged(
      { operation: 'SEARCH', requestedBy, criteria },
      () => this.inner.search(query, requestedBy),
      (result) => ({
        resultStatus: result.resultStatus,
        totalItems: result.totalItems,
        page: result.page,
        returned: result.items.length,
      }),
    );
  }

  getDetail(invoiceId: unknown, requestedBy: string): Promise<InvoiceDetail> {
    return this.logged(
      { operation: 'DETAIL', requestedBy, invoiceId: String(invoiceId) },
      () => this.inner.getDetail(invoiceId, requestedBy),
      (detail) => ({ invoiceNumber: detail.invoiceNumber }),
    );
  }

  summarizeByChannel(
    query: InvoiceSummaryQuery,
    requestedBy: string,
  ): Promise<InvoiceChannelSummary> {
    return this.logged(
      {
        operation: 'SUMMARY',
        requestedBy,
        issuedFrom: String(query.issuedFrom),
        issuedTo: String(query.issuedTo),
      },
      () => this.inner.summarizeByChannel(query, requestedBy),
      (summary) => ({
        channels: summary.channels.length,
        invoiceCount: summary.channels.reduce((total, channel) => total + channel.invoiceCount, 0),
      }),
    );
  }

  private async logged<T>(
    base: Record<string, unknown>,
    run: () => Promise<T>,
    outcome: (result: T) => Record<string, unknown>,
  ): Promise<T> {
    const startedAt = this.now();
    try {
      const result = await run();
      this.logger.log(
        JSON.stringify({
          ...base,
          result: 'OK',
          ...outcome(result),
          durationMs: this.now() - startedAt,
        }),
      );
      return result;
    } catch (error) {
      const errorCode =
        error instanceof Error && 'errorCode' in error
          ? String((error as { errorCode: unknown }).errorCode)
          : 'UNEXPECTED_ERROR';
      this.logger.warn(
        JSON.stringify({
          ...base,
          result: 'REJECTED',
          errorCode,
          durationMs: this.now() - startedAt,
        }),
      );
      throw error;
    }
  }
}
