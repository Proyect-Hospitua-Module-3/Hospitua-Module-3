// Feature 007 · Generar liquidación
import { Prisma, Settlement as SettlementRow } from '@prisma/client';
import { ChannelKind } from '../../../../../../domain/model/shared/channel.vo';
import {
  NewSettlement,
  Settlement,
  SETTLEMENT_STATUS,
} from '../../../../../../domain/model/settlement/settlement';

export type { SettlementRow };

// Las columnas DATE viajan como Date a medianoche UTC; se convierten a la fecha civil
// YYYY-MM-DD sin pasar por la zona horaria local. Los importes viajan como texto.
export class SettlementMapper {
  static toCreateInput(settlement: NewSettlement): Prisma.SettlementCreateInput {
    return {
      id: settlement.settlementId,
      stayId: settlement.stayId,
      reservationRef: settlement.reservationRef,
      roomId: settlement.roomId,
      categoryRoom: settlement.categoryRoom,
      checkInDate: toDbDate(settlement.checkInDate),
      checkOutDate: toDbDate(settlement.checkOutDate),
      quoteId: settlement.quoteId,
      channel: settlement.channel,
      otaId: settlement.otaId,
      otaConfirmationCode: settlement.otaConfirmationCode,
      otaCommissionPercentage: settlement.otaCommissionPercentage,
      currency: settlement.currency,
      lodgingAmount: settlement.lodgingAmount,
      baseLodgingAmount: settlement.baseLodgingAmount,
      dynamicAdjustmentAmount: settlement.dynamicAdjustmentAmount,
      otaCommissionAmount: settlement.otaCommissionAmount,
      netIncome: settlement.netIncome,
      status: SETTLEMENT_STATUS,
      sourceEventId: settlement.sourceEventId,
      // generated_at no se envía: lo pone la base de datos (NFR-003).
    };
  }

  static toDomain(row: SettlementRow): Settlement {
    return Settlement.restore({
      settlementId: row.id,
      stayId: row.stayId,
      reservationRef: row.reservationRef,
      roomId: row.roomId,
      categoryRoom: row.categoryRoom,
      checkInDate: fromDbDate(row.checkInDate),
      checkOutDate: fromDbDate(row.checkOutDate),
      quoteId: row.quoteId,
      // Un CHECK de la migración garantiza que solo hay DIRECT u OTA.
      channel: row.channel as ChannelKind,
      otaId: row.otaId,
      otaConfirmationCode: row.otaConfirmationCode,
      otaCommissionPercentage: row.otaCommissionPercentage?.toFixed(2) ?? null,
      currency: row.currency,
      lodgingAmount: row.lodgingAmount.toFixed(2),
      baseLodgingAmount: row.baseLodgingAmount.toFixed(2),
      dynamicAdjustmentAmount: row.dynamicAdjustmentAmount.toFixed(2),
      otaCommissionAmount: row.otaCommissionAmount.toFixed(2),
      netIncome: row.netIncome.toFixed(2),
      sourceEventId: row.sourceEventId,
      generatedAt: row.generatedAt,
    });
  }
}

function toDbDate(civilDate: string): Date {
  return new Date(`${civilDate}T00:00:00.000Z`);
}

function fromDbDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}
