// Feature 006 · Generar factura final
import { DomainError } from '../domain.error';

// La base de datos no respondió al leer o emitir la factura (conexión, timeout o commit).
// Es reintentable: la transacción revierte el consecutivo y la factura juntos, así que el
// reintento de 010 no deja huecos en la numeración (NFR-003).
export class InvoicePersistenceUnavailableError extends DomainError {
  readonly errorCode = 'DATABASE_UNAVAILABLE';

  constructor(readonly cause?: unknown) {
    super(
      'No se pudo acceder a las facturas en la base de datos; la operación puede reintentarse.',
    );
  }
}
