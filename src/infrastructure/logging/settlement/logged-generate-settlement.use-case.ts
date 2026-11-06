// Feature 007 · Generar liquidación
import { Logger } from '@nestjs/common';
import { Settlement } from '../../../domain/model/settlement/settlement';
import {
  GenerateSettlementCommand,
  GenerateSettlementUseCase,
} from '../../../domain/ports/in/settlement/generate-settlement.use-case';

// Envuelve el caso de uso para dejar un log estructurado de cada generación (T032,
// NFR-003): estancia, reserva, canal, cotización, resultado o errorCode y duración.
// Vive en infraestructura para que el servicio de aplicación no dependa de NestJS.
// Nunca registra datos personales ni tributarios (NFR-006).
export class LoggedGenerateSettlementUseCase implements GenerateSettlementUseCase {
  private readonly logger = new Logger('GenerateSettlement');

  constructor(
    private readonly inner: GenerateSettlementUseCase,
    private readonly now: () => number = Date.now,
  ) {}

  async generate(command: GenerateSettlementCommand): Promise<Settlement> {
    const startedAt = this.now();
    const base = {
      eventId: command.eventId,
      stayId: command.stayId,
      reservationRef: command.reservationRef,
    };
    try {
      const settlement = await this.inner.generate(command);
      this.logger.log(
        JSON.stringify({
          ...base,
          result: 'FINAL',
          settlementId: settlement.settlementId,
          channel: settlement.channel,
          quoteId: settlement.quoteId,
          durationMs: this.now() - startedAt,
        }),
      );
      return settlement;
    } catch (error) {
      const errorCode =
        error instanceof Error && 'errorCode' in error
          ? String((error as { errorCode: unknown }).errorCode)
          : 'UNEXPECTED_ERROR';
      this.logger.warn(
        JSON.stringify({
          ...base,
          result: 'REJECTED',
          errorCode,
          durationMs: this.now() - startedAt,
        }),
      );
      throw error;
    }
  }
}
