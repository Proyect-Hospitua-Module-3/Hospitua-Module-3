// Feature 008 · Gestionar facturación
import { DomainError } from '../domain.error';

// No existe una factura con ese id (contrato GET-invoices-id.md).
export class InvoiceNotFoundError extends DomainError {
  readonly errorCode = 'INVOICE_NOT_FOUND';

  constructor(invoiceId: string) {
    super(`No existe una factura con el identificador ${invoiceId}.`);
  }
}
