// Feature 005 · Consultar tarifa dinámica
import { LodgingQuote } from '../../../model/pricing/lodging-quote';

export const LODGING_QUOTE_REPOSITORY = Symbol('LodgingQuoteRepositoryPort');

// Solo inserta: no hay update ni delete porque la cotización es inmutable (BR-006).
// Guarda la cotización y todas sus noches en una sola transacción: si algo falla no
// queda ninguna cotización parcial.
export interface LodgingQuoteRepositoryPort {
  insert(quote: LodgingQuote): Promise<void>;
}
