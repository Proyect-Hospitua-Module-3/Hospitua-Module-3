// Feature 005 · Consultar tarifa dinámica
// Contrato: features/005-consultar-tarifa-dinamica/2-technical/contracts/PORT-find-lodging-quotes-by-ids.md
import { LodgingQuote } from '../../../model/pricing/lodging-quote';

export const LODGING_QUOTE_QUERY = Symbol('LodgingQuoteQueryPort');

// Lectura de cotizaciones guardadas. Lo implementa 005 y lo consume 007 (settlement)
// para tomar el valor de hospedaje sin recalcular la tarifa dinámica.
// - Solo lectura: nunca calcula ni consulta a Módulo 1, 009 ni 011.
// - Un quoteId que no existe no da error: no aparece en el resultado. Lista vacía → [].
// - Sin orden garantizado.
// - Si la base de datos falla, el error se propaga (nunca devuelve [] como reemplazo).
export interface LodgingQuoteQueryPort {
  findByIds(quoteIds: string[]): Promise<LodgingQuote[]>;
}
