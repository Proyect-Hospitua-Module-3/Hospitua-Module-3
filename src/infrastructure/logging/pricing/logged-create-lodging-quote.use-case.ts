// Feature 005 · Consultar tarifa dinámica
import { Logger } from '@nestjs/common';
import { LodgingQuote } from '../../../domain/model/pricing/lodging-quote';
import {
  CreateLodgingQuoteCommand,
  CreateLodgingQuoteUseCase,
} from '../../../domain/ports/in/pricing/create-lodging-quote.use-case';

// Envuelve el caso de uso para dejar un log estructurado de cada cotización (T046):
// quoteId, roomId, rango, total y duración; si se rechaza, el errorCode. Vive en
// infraestructura para que el servicio de aplicación no dependa de NestJS (igual que 007).
// La cotización no lleva datos del huésped: solo habitación, fechas e importes.
export class LoggedCreateLodgingQuoteUseCase implements CreateLodgingQuoteUseCase {
  private readonly logger = new Logger('CreateLodgingQuote');

  constructor(
    private readonly inner: CreateLodgingQuoteUseCase,
    private readonly now: () => number = Date.now,
  ) {}

  async create(command: CreateLodgingQuoteCommand): Promise<LodgingQuote> {
    const startedAt = this.now();
    try {
      const quote = await this.inner.create(command);
      this.logger.log(
        JSON.stringify({
          result: 'CREATED',
          quoteId: quote.quoteId,
          roomId: quote.roomId,
          checkInDate: quote.checkInDate,
          checkOutDate: quote.checkOutDate,
          lodgingAmount: quote.lodgingAmount,
          durationMs: this.now() - startedAt,
        }),
      );
      return quote;
    } catch (error) {
      const errorCode =
        error instanceof Error && 'errorCode' in error
          ? String((error as { errorCode: unknown }).errorCode)
          : 'UNEXPECTED_ERROR';
      // Sin cotización: se registra lo que se pidió, tal como llegó.
      this.logger.warn(
        JSON.stringify({
          result: 'REJECTED',
          roomId: command.roomId,
          checkInDate: command.checkInDate,
          checkOutDate: command.checkOutDate,
          errorCode,
          durationMs: this.now() - startedAt,
        }),
      );
      throw error;
    }
  }
}
