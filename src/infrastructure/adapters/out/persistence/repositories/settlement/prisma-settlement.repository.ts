// Feature 007 · Generar liquidación
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { NewSettlement, Settlement } from '../../../../../../domain/model/settlement/settlement';
import {
  SettlementRepositoryPort,
  STAY_ALREADY_SETTLED,
} from '../../../../../../domain/ports/out/settlement/settlement.repository.port';
import { SettlementMapper } from '../../mappers/settlement/settlement.mapper';
import { PrismaService } from '../../prisma.service';

// Violación de una restricción UNIQUE en Prisma.
const UNIQUE_VIOLATION = 'P2002';
// Según la versión, Prisma nombra la columna, el campo o el índice (settlement_stay_id_key).
const STAY_ID_TARGETS = ['stay_id', 'stayId'];

// PostgreSQL acepta en una columna uuid cualquier texto hexadecimal 8-4-4-4-12.
const UUID_FORMAT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Archivo de acceso a datos de las liquidaciones. Solo INSERT y SELECT: no hay ningún
// UPDATE ni DELETE, porque la liquidación es inmutable (FR-009, FR-017).
@Injectable()
export class PrismaSettlementRepository implements SettlementRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async findByStayId(stayId: string): Promise<Settlement | null> {
    const row = await this.prisma.settlement.findUnique({ where: { stayId } });
    return row ? SettlementMapper.toDomain(row) : null;
  }

  // Si dos entregas del mismo check-out llegan a la vez, UNIQUE(stay_id) deja pasar solo
  // una; la otra recibe STAY_ALREADY_SETTLED en lugar de un error genérico (FR-011).
  async insert(settlement: NewSettlement): Promise<Settlement | typeof STAY_ALREADY_SETTLED> {
    try {
      const row = await this.prisma.settlement.create({
        data: SettlementMapper.toCreateInput(settlement),
      });
      return SettlementMapper.toDomain(row);
    } catch (error) {
      if (isStayConflict(error)) return STAY_ALREADY_SETTLED;
      throw error;
    }
  }

  // Para 002. Una habitación tiene una sola estancia por reserva; si hubiera varias, se
  // devuelve siempre la misma (la más reciente) para que la consulta sea determinista.
  async findByReservationAndRoom(
    reservationRef: string,
    roomId: string,
  ): Promise<Settlement | null> {
    if (!UUID_FORMAT.test(roomId)) return null;
    const row = await this.prisma.settlement.findFirst({
      where: { reservationRef, roomId },
      orderBy: [{ generatedAt: 'desc' }, { id: 'asc' }],
    });
    return row ? SettlementMapper.toDomain(row) : null;
  }
}

function isStayConflict(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== UNIQUE_VIOLATION) {
    return false;
  }
  const target = JSON.stringify(error.meta?.target ?? '');
  return STAY_ID_TARGETS.some((name) => target.includes(name));
}
