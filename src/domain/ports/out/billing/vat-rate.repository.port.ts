// Feature 001 · Actualizar porcentaje de IVA
import { VatRate } from '../../../model/billing/vat-rate';
import { VatRateValue } from '../../../model/billing/vat-rate-value.vo';

export const VAT_RATE_REPOSITORY = Symbol('VatRateRepositoryPort');

// Persistencia del porcentaje de IVA vigente y de su historial.
//
// Una actualización nunca alcanza facturas ya emitidas: la factura (006) guarda el
// porcentaje aplicado como campo propio (`vat_rate_applied`) al emitirse y no tiene
// una referencia viva a `vat_rate`. Esa es la garantía estructural de BR-002 y FR-004,
// no una validación en tiempo de ejecución.
export interface VatRateRepositoryPort {
  // `null` si nunca se registró un porcentaje.
  getCurrent(): Promise<VatRate | null>;

  // Guarda el nuevo vigente y su entrada de historial en una sola transacción,
  // serializada frente a otras actualizaciones. Si el historial falla, no cambia nada.
  saveNew(value: VatRateValue, actorId: string): Promise<VatRate>;
}
