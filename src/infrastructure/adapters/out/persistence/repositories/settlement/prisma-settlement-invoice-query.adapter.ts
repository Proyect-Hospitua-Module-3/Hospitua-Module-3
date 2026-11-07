// Feature 002 · Consultar liquidación
import { Injectable } from '@nestjs/common';
import { InvoiceSummary } from '../../../../../../domain/model/settlement/settlement-query-result';
import { SettlementInvoiceQueryPort } from '../../../../../../domain/ports/out/settlement/settlement-invoice-query.port';
import { PrismaService } from '../../prisma.service';
import { readOnlyTransaction } from './read-only-transaction';

// Lectura de la factura que emitió 006 para una liquidación (FR-003). Lee la tabla invoice
// directamente y sin usar código de billing: settlement nunca importa billing (prueba de
// arquitectura de 007). Solo SELECT, en una transacción READ ONLY.
@Injectable()
export class PrismaSettlementInvoiceQueryAdapter implements SettlementInvoiceQueryPort {
  constructor(private readonly prisma: PrismaService) {}

  async findBySettlementId(settlementId: string): Promise<InvoiceSummary | null> {
    // Solo las columnas del contrato: nunca los datos tributarios del cliente (FR-007).
    const row = await readOnlyTransaction(this.prisma, (tx) =>
      tx.invoice.findUnique({
        where: { settlementId },
        select: {
          id: true,
          invoiceNumber: true,
          issuedAt: true,
          vatRateApplied: true,
          vatAmount: true,
          totalAmount: true,
          status: true,
        },
      }),
    );
    if (!row) return null;
    return {
      invoiceId: row.id,
      // BIGINT → number: exacto hasta 2^53, muy por encima de cualquier consecutivo real.
      invoiceNumber: Number(row.invoiceNumber),
      issuedAt: row.issuedAt,
      vatRateApplied: row.vatRateApplied.toFixed(2),
      vatAmount: row.vatAmount.toFixed(2),
      totalAmount: row.totalAmount.toFixed(2),
      status: row.status,
    };
  }
}
