// Feature 006 · Generar factura final
import { Invoice, InvoiceDraft } from '../../../model/billing/invoice';

export const INVOICE_ISSUANCE_REPOSITORY = Symbol('InvoiceIssuanceRepositoryPort');

// Solo lee y emite: no hay update ni delete porque la factura es inmutable (FR-006).
// Si la base de datos no responde, lanza InvoicePersistenceUnavailableError (reintentable).
export interface InvoiceIssuanceRepositoryPort {
  findByStayId(stayId: string): Promise<Invoice | null>;

  // En una sola transacción: bloquea el consecutivo, vuelve a buscar la factura de la
  // estancia o de la liquidación, asigna el siguiente número y guarda la factura. Si ya
  // existía (reenvío o carrera concurrente) devuelve esa, sin consumir número. Un fallo
  // revierte el consecutivo y la factura juntos (FR-005, FR-007, FR-011, NFR-003).
  issueIfAbsent(draft: InvoiceDraft): Promise<Invoice>;
}
