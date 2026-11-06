// Feature 005 · Consultar tarifa dinámica
// Contrato: features/005-consultar-tarifa-dinamica/2-technical/contracts/POST-pricing-quotes.md
import { LodgingQuote } from '../../../model/pricing/lodging-quote';

export const CREATE_LODGING_QUOTE_USE_CASE = Symbol('CreateLodgingQuoteUseCase');

export interface CreateLodgingQuoteCommand {
  roomId?: string;
  checkInDate?: string;
  // Exclusiva: la noche de esa fecha no se cotiza.
  checkOutDate?: string;
}

// Solo Módulo 2, al crear la reserva: calcula cada noche y guarda la cotización
// inmutable en una sola transacción. Si algo falla no se guarda nada (FR-015).
export interface CreateLodgingQuoteUseCase {
  create(command: CreateLodgingQuoteCommand): Promise<LodgingQuote>;
}
