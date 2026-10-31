// Feature 001 · Actualizar porcentaje de IVA
import { Injectable } from '@nestjs/common';
import { VatRate } from '../../../../../../domain/model/billing/vat-rate';
import { VatRateValue } from '../../../../../../domain/model/billing/vat-rate-value.vo';
import { VatRateRepositoryPort } from '../../../../../../domain/ports/out/billing/vat-rate.repository.port';
import { VatRateMapper, VatRateRow } from '../../mappers/billing/vat-rate.mapper';
import { PrismaService } from '../../prisma.service';

// `vat_rate` es de fila única: siempre id = 1 (lo exige un CHECK en la migración).
const VAT_RATE_ROW_ID = 1;

@Injectable()
export class PrismaVatRateRepository implements VatRateRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async getCurrent(): Promise<VatRate | null> {
    const rows = await this.prisma.$queryRaw<VatRateRow[]>`
      SELECT value, updated_by, updated_at FROM vat_rate WHERE id = ${VAT_RATE_ROW_ID}`;
    return rows.length > 0 ? VatRateMapper.toDomain(rows[0]) : null;
  }

  async saveNew(value: VatRateValue, actorId: string): Promise<VatRate> {
    return this.prisma.$transaction(async (tx) => {
      // Serializa todas las actualizaciones, incluida la primera, cuando la tabla
      // está vacía y no hay fila que bloquear. Se libera al terminar la transacción.
      // 1001 es la clave fija del bloqueo del IVA dentro de Módulo 3.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(1001)`;

      const previous = await tx.vatRate.findUnique({ where: { id: VAT_RATE_ROW_ID } });

      // Hora de la base de datos, no del servidor de aplicación (NFR-001). Se usa
      // clock_timestamp() y no now(): now() es la hora en que empezó la transacción,
      // antes de esperar el bloqueo, y desordenaría el historial bajo concurrencia.
      const [saved] = await tx.$queryRaw<VatRateRow[]>`
        INSERT INTO vat_rate (id, value, updated_by, updated_at)
        VALUES (${VAT_RATE_ROW_ID}, ${value.toString()}::numeric, ${actorId}::uuid, clock_timestamp())
        ON CONFLICT (id) DO UPDATE
          SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at
        RETURNING value, updated_by, updated_at`;

      // Toda actualización exitosa queda trazada, incluso con el mismo valor (T021).
      // Si este insert falla, la transacción revierte también el cambio del vigente (FR-005).
      // changed_at se copia en SQL de updated_at: pasar la hora por JavaScript perdería
      // los microsegundos y las dos horas dejarían de coincidir.
      const valueBefore = previous ? previous.value.toFixed(2) : null;
      await tx.$executeRaw`
        INSERT INTO vat_rate_history (value_before, value_after, changed_by, changed_at)
        SELECT ${valueBefore}::numeric, value, updated_by, updated_at
        FROM vat_rate WHERE id = ${VAT_RATE_ROW_ID}`;

      return VatRateMapper.toDomain(saved);
    });
  }
}
