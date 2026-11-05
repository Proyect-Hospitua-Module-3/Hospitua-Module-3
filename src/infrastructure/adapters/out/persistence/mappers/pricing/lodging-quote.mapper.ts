// Feature 005 · Consultar tarifa dinámica
import { Prisma } from '@prisma/client';
import { LodgingQuote } from '../../../../../../domain/model/pricing/lodging-quote';

export type LodgingQuoteRow = Prisma.LodgingQuoteGetPayload<{ include: { nights: true } }>;

// Las columnas DATE viajan como Date a medianoche UTC; se convierten a la fecha civil
// YYYY-MM-DD sin pasar por la zona horaria local. Los importes viajan como texto.
export class LodgingQuoteMapper {
  static toCreateInput(quote: LodgingQuote): Prisma.LodgingQuoteCreateInput {
    return {
      id: quote.quoteId,
      roomId: quote.roomId,
      checkInDate: toDbDate(quote.checkInDate),
      checkOutDate: toDbDate(quote.checkOutDate),
      currency: quote.currency,
      lodgingAmount: quote.lodgingAmount,
      nights: {
        create: quote.nights.map((night) => ({
          nightDate: toDbDate(night.date),
          baseRate: night.baseRate,
          seasonName: night.seasonName,
          adjustmentPercent: night.adjustmentPercent,
          rate: night.rate,
        })),
      },
    };
  }

  static toDomain(row: LodgingQuoteRow): LodgingQuote {
    return LodgingQuote.restore({
      quoteId: row.id,
      roomId: row.roomId,
      checkInDate: fromDbDate(row.checkInDate),
      checkOutDate: fromDbDate(row.checkOutDate),
      currency: row.currency,
      lodgingAmount: row.lodgingAmount.toFixed(2),
      nights: [...row.nights]
        .sort((a, b) => a.nightDate.getTime() - b.nightDate.getTime())
        .map((night) => ({
          date: fromDbDate(night.nightDate),
          baseRate: night.baseRate.toFixed(2),
          seasonName: night.seasonName,
          adjustmentPercent: night.adjustmentPercent.toFixed(2),
          rate: night.rate.toFixed(2),
        })),
    });
  }
}

function toDbDate(civilDate: string): Date {
  return new Date(`${civilDate}T00:00:00.000Z`);
}

function fromDbDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}
