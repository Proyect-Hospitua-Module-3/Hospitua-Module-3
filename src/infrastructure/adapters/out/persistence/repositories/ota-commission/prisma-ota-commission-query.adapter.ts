// Feature 003 · Consultar porcentaje de comisión OTA
import { Injectable } from '@nestjs/common';
import { OtaCommissionReference } from '../../../../../../domain/model/ota-commission/ota-commission-reference';
import { OtaCommissionQueryPort } from '../../../../../../domain/ports/out/ota-commission/ota-commission-query.port';
import { PrismaService } from '../../prisma.service';
import { readOnlyTransaction } from '../settlement/read-only-transaction';

const OTA_CHANNEL = 'OTA';

// SELECT puro sobre settlement (tabla de 007) en una transacción READ ONLY: PostgreSQL
// rechazaría cualquier escritura, así que la consulta no puede crear ni corregir porcentajes
// (FR-005, BR-002). Sin caché (T025).
@Injectable()
export class PrismaOtaCommissionQueryAdapter implements OtaCommissionQueryPort {
  constructor(private readonly prisma: PrismaService) {}

  // channel = 'OTA': el canal directo nunca sale (FR-006, NFR-004). Orden por generated_at
  // descendente con el índice (ota_id, generated_at DESC) de 007; el id desempata dos
  // liquidaciones del mismo instante para que el resultado sea siempre el mismo (NFR-001).
  // Solo las columnas que forman la respuesta: nada del huésped ni de la reserva (NFR-003).
  async findLatestByOtaId(otaId: string): Promise<OtaCommissionReference | null> {
    const row = await readOnlyTransaction(this.prisma, (tx) =>
      tx.settlement.findFirst({
        where: { otaId, channel: OTA_CHANNEL, otaCommissionPercentage: { not: null } },
        orderBy: [{ generatedAt: 'desc' }, { id: 'desc' }],
        select: { id: true, otaId: true, otaCommissionPercentage: true, generatedAt: true },
      }),
    );
    if (!row || row.otaId === null || row.otaCommissionPercentage === null) {
      return null;
    }
    return OtaCommissionReference.of({
      otaId: row.otaId,
      percentage: row.otaCommissionPercentage.toFixed(2),
      settlementId: row.id,
      settlementDate: row.generatedAt,
    });
  }
}
