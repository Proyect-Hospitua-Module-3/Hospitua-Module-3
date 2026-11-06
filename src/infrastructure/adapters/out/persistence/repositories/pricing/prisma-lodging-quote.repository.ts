// Feature 005 · Consultar tarifa dinámica
import { Injectable } from '@nestjs/common';
import { LodgingQuote } from '../../../../../../domain/model/pricing/lodging-quote';
import { LodgingQuoteQueryPort } from '../../../../../../domain/ports/out/pricing/lodging-quote-query.port';
import { LodgingQuoteRepositoryPort } from '../../../../../../domain/ports/out/pricing/lodging-quote.repository.port';
import { LodgingQuoteMapper } from '../../mappers/pricing/lodging-quote.mapper';
import { PrismaService } from '../../prisma.service';

// PostgreSQL acepta en una columna uuid cualquier texto hexadecimal 8-4-4-4-12.
const UUID_FORMAT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Archivo de acceso a datos de las cotizaciones. Solo INSERT y SELECT: no hay ningún
// UPDATE ni DELETE, porque la cotización es inmutable (BR-006, FR-013).
@Injectable()
export class PrismaLodgingQuoteRepository
  implements LodgingQuoteRepositoryPort, LodgingQuoteQueryPort
{
  constructor(private readonly prisma: PrismaService) {}

  // Un solo create anidado: Prisma inserta la cotización y sus noches en una misma
  // transacción, así que si algo falla no queda una cotización parcial (FR-015).
  async insert(quote: LodgingQuote): Promise<void> {
    await this.prisma.lodgingQuote.create({ data: LodgingQuoteMapper.toCreateInput(quote) });
  }

  // Contrato PORT-find-lodging-quotes-by-ids: un id que no existe (o que ni siquiera es
  // un UUID) no da error, simplemente no aparece; sin orden garantizado; si la base
  // falla, el error se propaga.
  async findByIds(quoteIds: string[]): Promise<LodgingQuote[]> {
    const ids = [...new Set(quoteIds.filter((id) => UUID_FORMAT.test(id)))];
    if (ids.length === 0) return [];

    const rows = await this.prisma.lodgingQuote.findMany({
      where: { id: { in: ids } },
      include: { nights: true },
    });
    return rows.map((row) => LodgingQuoteMapper.toDomain(row));
  }
}
