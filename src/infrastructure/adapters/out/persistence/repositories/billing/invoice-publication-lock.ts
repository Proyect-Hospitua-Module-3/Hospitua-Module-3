// Features 006 y 008 · Publicación de facturas y corte estable de las búsquedas.
// Espacio (8, 1), distinto del calendario (11, año) y del IVA (1001, bigint).
// Se toma antes del contador de 006; nunca se solicita en el orden inverso.
export const INVOICE_PUBLICATION_LOCK_NAMESPACE = 8;
export const INVOICE_PUBLICATION_LOCK_KEY = 1;
