// Feature 006 · Generar factura final
// Contrato: features/006-generar-factura-final/2-technical/contracts/UC-generate-final-invoice.md
import { Invoice } from '../../../model/billing/invoice';

export const GENERATE_FINAL_INVOICE_USE_CASE = Symbol('GenerateFinalInvoiceUseCase');

export const BILLING_CUSTOMER_DATA_MISSING = 'BILLING_CUSTOMER_DATA_MISSING';

// Datos del check-out de una habitación tal como los arma 010 desde el evento
// facturacion.checkout, más los datos tributarios que solo usa 006. Son los mismos campos
// de GenerateSettlementCommand (007); 006 se los pasa a 007 sin billingCustomer. Nunca trae
// importes, IVA, comisión, canal, número de factura ni datos migratorios (FR-013).
export interface GenerateFinalInvoiceCommand {
  eventId: string;
  stayId: string;
  reservationRef: string;
  roomId: string;
  categoryRoom: string;
  checkInDate: string;
  checkOutDate: string;
  // Opcional en el evento; completo (nombre y documento) para emitir (FR-008).
  billingCustomer?: { name?: string | null; taxId?: string | null } | null;
}

// La falta de datos tributarios no es un error: es un resultado sin emisión (FR-009).
export type GenerateFinalInvoiceResult =
  | { status: 'ISSUED'; invoice: Invoice } // emitida ahora o recuperada por idempotencia
  | { status: 'NOT_ISSUED'; reason: typeof BILLING_CUSTOMER_DATA_MISSING };

// Solo lo invoca 010 (Registrar check-out); no tiene endpoint ni controller (FR-001,
// BR-001). Idempotente por stayId (FR-007).
export interface GenerateFinalInvoiceUseCase {
  generate(command: GenerateFinalInvoiceCommand): Promise<GenerateFinalInvoiceResult>;
}
