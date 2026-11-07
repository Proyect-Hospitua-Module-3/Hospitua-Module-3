// Feature 006 · Generar factura final
import { Logger } from '@nestjs/common';
import {
  GenerateFinalInvoiceCommand,
  GenerateFinalInvoiceResult,
  GenerateFinalInvoiceUseCase,
} from '../../../domain/ports/in/billing/generate-final-invoice.use-case';

// Envuelve el caso de uso para dejar un log estructurado de cada intento (T035): evento,
// estancia, liquidación, factura y número si existen, resultado o errorCode y duración.
// Vive en infraestructura para que el servicio de aplicación no dependa de NestJS.
// Nunca registra billingCustomer (nombre ni documento fiscal) ni datos migratorios (T034,
// NFR-005).
export class LoggedGenerateFinalInvoiceUseCase implements GenerateFinalInvoiceUseCase {
  private readonly logger = new Logger('GenerateFinalInvoice');

  constructor(
    private readonly inner: GenerateFinalInvoiceUseCase,
    private readonly now: () => number = Date.now,
  ) {}

  async generate(command: GenerateFinalInvoiceCommand): Promise<GenerateFinalInvoiceResult> {
    const startedAt = this.now();
    const base = { eventId: command.eventId, stayId: command.stayId };
    try {
      const result = await this.inner.generate(command);
      if (result.status === 'ISSUED') {
        this.logger.log(
          JSON.stringify({
            ...base,
            result: 'ISSUED',
            settlementId: result.invoice.settlementId,
            invoiceId: result.invoice.invoiceId,
            invoiceNumber: result.invoice.invoiceNumber,
            durationMs: this.now() - startedAt,
          }),
        );
      } else {
        this.logger.warn(
          JSON.stringify({
            ...base,
            result: 'NOT_ISSUED',
            reason: result.reason,
            durationMs: this.now() - startedAt,
          }),
        );
      }
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
