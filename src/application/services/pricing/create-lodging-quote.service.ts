// Feature 005 · Consultar tarifa dinámica
import { randomUUID } from 'node:crypto';
import { LodgingQuote } from '../../../domain/model/pricing/lodging-quote';
import {
  CreateLodgingQuoteCommand,
  CreateLodgingQuoteUseCase,
} from '../../../domain/ports/in/pricing/create-lodging-quote.use-case';
import { LodgingQuoteRepositoryPort } from '../../../domain/ports/out/pricing/lodging-quote.repository.port';
import { DynamicRateCalculator } from './dynamic-rate-calculator';
import { parseRoomId, parseStay } from './pricing-request';

// Cotización del hospedaje de una habitación para Módulo 2 (HU3). Usa el mismo cálculo
// que la consulta y guarda el resultado una sola vez; nunca se recalcula (FR-013).
export class CreateLodgingQuoteService implements CreateLodgingQuoteUseCase {
  constructor(
    private readonly calculator: DynamicRateCalculator,
    private readonly quotes: LodgingQuoteRepositoryPort,
    private readonly newQuoteId: () => string = randomUUID,
  ) {}

  async create(command: CreateLodgingQuoteCommand): Promise<LodgingQuote> {
    // Entrada y rango primero, sin llamar a ningún puerto (contrato POST, regla 1).
    const roomId = parseRoomId(command.roomId);
    const stay = parseStay(command.checkInDate, command.checkOutDate);

    // Si cualquier noche falla, el error sale de aquí y no se guarda nada (FR-015).
    const nights = await this.calculator.calculate(roomId, stay);
    const quote = LodgingQuote.create({
      quoteId: this.newQuoteId(),
      // En minúsculas, como lo guarda y lo devuelve PostgreSQL (uuid): la cotización
      // que se lee después es idéntica a la que se crea.
      roomId: roomId.toLowerCase(),
      stay,
      nights,
    });
    await this.quotes.insert(quote);
    return quote;
  }
}
