// Feature 010 · Registrar Check-out
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  CheckoutEventLog,
  NewCheckoutEventLog,
} from '../../../../../../domain/model/checkout-ingestion/checkout-event-log';
import { CheckoutEventLogRepositoryPort } from '../../../../../../domain/ports/out/checkout-ingestion/checkout-event-log.repository.port';
import {
  CheckoutEventLogMapper,
  CheckoutEventLogRow,
} from '../../mappers/checkout-ingestion/checkout-event-log.mapper';
import { PrismaService } from '../../prisma.service';

const INVALID_CHECKOUT_EVENT = 'INVALID_CHECKOUT_EVENT';

const COLUMNS = Prisma.sql`
  id::text AS id, event_id::text AS event_id, event_type, occurred_at, payload,
  stay_id::text AS stay_id, status, error_code, reason, result_note, processed_at, created_at`;

// Las horas salen de la base de datos con clock_timestamp(), igual que en 001 y 009.
@Injectable()
export class PrismaCheckoutEventLogRepository implements CheckoutEventLogRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async registerIfAbsent(eventLog: NewCheckoutEventLog): Promise<CheckoutEventLog> {
    // El índice único parcial sobre event_id resuelve dos entregas simultáneas del mismo
    // evento: una inserta y la otra no hace nada y lee el registro existente.
    const inserted = await this.prisma.$queryRaw<CheckoutEventLogRow[]>`
      INSERT INTO checkout_event_log (event_id, event_type, occurred_at, payload, stay_id, status)
      VALUES (${eventLog.eventId}::uuid, ${eventLog.eventType}, ${eventLog.occurredAt}::timestamptz,
              ${JSON.stringify(eventLog.payload)}::jsonb, ${eventLog.stayId}::uuid, 'PENDING')
      ON CONFLICT (event_id) WHERE event_id IS NOT NULL DO NOTHING
      RETURNING ${COLUMNS}`;
    if (inserted.length > 0) {
      return CheckoutEventLogMapper.toDomain(inserted[0]);
    }
    const [existing] = await this.prisma.$queryRaw<CheckoutEventLogRow[]>`
      SELECT ${COLUMNS} FROM checkout_event_log WHERE event_id = ${eventLog.eventId}::uuid`;
    return CheckoutEventLogMapper.toDomain(existing);
  }

  async markProcessed(eventId: string, resultNote: string | null = null): Promise<void> {
    await this.prisma.$executeRaw`
      UPDATE checkout_event_log
      SET status = 'PROCESSED', result_note = ${resultNote}, error_code = NULL, reason = NULL,
          processed_at = clock_timestamp()
      WHERE event_id = ${eventId}::uuid AND status = 'PENDING'`;
  }

  async markRejected(eventId: string, errorCode: string, reason: string): Promise<void> {
    await this.close(eventId, 'REJECTED', errorCode, reason);
  }

  async markDeadLetter(eventId: string, errorCode: string, reason: string): Promise<void> {
    await this.close(eventId, 'DEAD_LETTER', errorCode, reason);
  }

  async registerUnrecognizedEnvelopeRejection(reason: string): Promise<void> {
    // Sin event_id ni payload: el cuerpo crudo no se guarda (el mensaje en la DLQ sí lo conserva).
    await this.prisma.$executeRaw`
      INSERT INTO checkout_event_log (status, error_code, reason, processed_at)
      VALUES ('REJECTED', ${INVALID_CHECKOUT_EVENT}, ${reason}, clock_timestamp())`;
  }

  private async close(
    eventId: string,
    status: 'REJECTED' | 'DEAD_LETTER',
    errorCode: string,
    reason: string,
  ): Promise<void> {
    await this.prisma.$executeRaw`
      UPDATE checkout_event_log
      SET status = ${status}, error_code = ${errorCode}, reason = ${reason},
          processed_at = clock_timestamp()
      WHERE event_id = ${eventId}::uuid AND status = 'PENDING'`;
  }
}
