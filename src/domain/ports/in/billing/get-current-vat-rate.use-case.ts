// Feature 001 · Actualizar porcentaje de IVA
import { VatRate } from '../../../model/billing/vat-rate';

export const GET_CURRENT_VAT_RATE_USE_CASE = Symbol('GetCurrentVatRateUseCase');

// Lectura interna del porcentaje vigente: la única vía por la que 006 lo obtiene
// (contrato PORT-get-current-vat-rate.md de 006).
export interface GetCurrentVatRateUseCase {
  // Lanza VatRateNotConfiguredError si nunca se registró un porcentaje y
  // VatRateUnavailableError si la lectura falla. Nunca devuelve 0 ni un valor por defecto.
  getCurrent(): Promise<VatRate>;
}
