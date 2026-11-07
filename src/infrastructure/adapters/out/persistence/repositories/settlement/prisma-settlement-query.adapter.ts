// Feature 002 · Consultar liquidación
import { Injectable } from '@nestjs/common';
import { Settlement } from '../../../../../../domain/model/settlement/settlement';
import { SettlementQueryPort } from '../../../../../../domain/ports/out/settlement/settlement-query.port';
import { SettlementMapper } from '../../mappers/settlement/settlement.mapper';
import { PrismaService } from '../../prisma.service';
import { readOnlyTransaction } from './read-only-transaction';

const OTA_CHANNEL = 'OTA';

// Lectura de liquidaciones Final para la OTA (HU1). Solo SELECT, en una transacción READ
// ONLY: 002 no escribe en settlement, que es de 007.
@Injectable()
export class PrismaSettlementQueryAdapter implements SettlementQueryPort {
  constructor(private readonly prisma: PrismaService) {}

  // Filtra por la OTA en la consulta: una reserva directa (ota_id nulo) o de otra OTA nunca
  // sale de la base de datos (FR-006, NFR-003). Orden por habitación y, si una habitación
  // tuviera más de una estancia en la reserva, por fecha de generación.
  async findByReservationRefAndOtaId(reservationRef: string, otaId: string): Promise<Settlement[]> {
    const rows = await readOnlyTransaction(this.prisma, (tx) =>
      tx.settlement.findMany({
        where: { reservationRef, otaId, channel: OTA_CHANNEL },
        orderBy: [{ roomId: 'asc' }, { generatedAt: 'asc' }, { id: 'asc' }],
      }),
    );
    return rows.map((row) => SettlementMapper.toDomain(row));
  }
}
