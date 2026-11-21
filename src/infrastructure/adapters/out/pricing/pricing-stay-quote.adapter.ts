// Feature 007 · Generar liquidación
import { LodgingQuote } from '../../../../domain/model/pricing/lodging-quote';
import { CreateLodgingQuoteUseCase } from '../../../../domain/ports/in/pricing/create-lodging-quote.use-case';
import {
  StayQuotePort,
  StayQuoteRequest,
} from '../../../../domain/ports/out/settlement/stay-quote.port';

// Implementa el puerto de settlement con el caso de uso de cotización de 005: mismo
// cálculo, mismo guardado y mismo log que POST /pricing/quotes.
export class PricingStayQuoteAdapter implements StayQuotePort {
  constructor(private readonly quotes: CreateLodgingQuoteUseCase) {}

  create(request: StayQuoteRequest): Promise<LodgingQuote> {
    return this.quotes.create({
      roomId: request.roomId,
      checkInDate: request.checkInDate,
      checkOutDate: request.checkOutDate,
    });
  }
}
