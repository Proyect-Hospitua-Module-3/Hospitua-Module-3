// Feature 007 · Generar liquidación
import { LodgingQuote } from '../../../model/pricing/lodging-quote';

export const STAY_QUOTE = Symbol('StayQuotePort');

export interface StayQuoteRequest {
  readonly roomId: string;
  readonly checkInDate: string;
  // Exclusiva: la noche de esa fecha no se cotiza.
  readonly checkOutDate: string;
}

// Cotización de la estancia de una reserva OTA que Módulo 2 no cotiza (Booking: llega con
// quoteIds vacía, acordado con Módulo 2 el 2026-11-20). La crea el motor de precios de 005
// al registrar el check-out y la guarda, igual que POST /pricing/quotes; la liquidación la
// usa como cualquier otra cotización. Es la única excepción a "settlement solo lee
// cotizaciones guardadas" (regla 5 del plan base).
export interface StayQuotePort {
  create(request: StayQuoteRequest): Promise<LodgingQuote>;
}
