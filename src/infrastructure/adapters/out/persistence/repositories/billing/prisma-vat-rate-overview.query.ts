// Feature 001 · Actualizar porcentaje de IVA
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { VatRateOverview } from '../../../../../../domain/model/billing/vat-rate-overview';
import { VatRateOverviewQueryPort } from '../../../../../../domain/ports/out/billing/vat-rate-overview.query.port';
import { PrismaService } from '../../prisma.service';

// `vat_rate` es de fila única: siempre id = 1 (lo exige un CHECK en la migración).
const VAT_RATE_ROW_ID = 1;

interface CurrentRow {
  value: Prisma.Decimal;
  updated_by: string;
  updated_at: Date;
  username: string | null;
}

interface HistoryRow {
  value_before: Prisma.Decimal | null;
  value_after: Prisma.Decimal;
  changed_by: string;
  changed_at: Date;
  username: string | null;
}

// Lectura para la pantalla de IVA. Las dos consultas van en una transacción REPEATABLE
// READ: el vigente y el historial salen de la misma instantánea, aunque otro Administrador
// guarde a la vez. LEFT JOIN: un usuario borrado no oculta el cambio (sale sin nombre).
@Injectable()
export class PrismaVatRateOverviewQuery implements VatRateOverviewQueryPort {
  constructor(private readonly prisma: PrismaService) {}

  async getOverview(historyLimit: number): Promise<VatRateOverview> {
    const [currentRows, historyRows] = await this.prisma.$transaction(
      [
        this.prisma.$queryRaw<CurrentRow[]>`
          SELECT v.value, v.updated_by, v.updated_at, u.username
          FROM vat_rate v LEFT JOIN app_user u ON u.id = v.updated_by
          WHERE v.id = ${VAT_RATE_ROW_ID}`,
        this.prisma.$queryRaw<HistoryRow[]>`
          SELECT h.value_before, h.value_after, h.changed_by, h.changed_at, u.username
          FROM vat_rate_history h LEFT JOIN app_user u ON u.id = h.changed_by
          ORDER BY h.changed_at DESC, h.id DESC
          LIMIT ${historyLimit}`,
      ],
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );

    const [current] = currentRows;
    return {
      current: current
        ? {
            value: current.value.toFixed(2),
            updatedBy: current.updated_by,
            updatedByUsername: current.username,
            updatedAt: current.updated_at,
          }
        : null,
      history: historyRows.map((row) => ({
        valueBefore: row.value_before?.toFixed(2) ?? null,
        valueAfter: row.value_after.toFixed(2),
        changedBy: row.changed_by,
        changedByUsername: row.username,
        changedAt: row.changed_at,
      })),
    };
  }
}
