// Feature 008 · Gestionar facturación
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ChannelTotals,
  InvoiceDetail,
  InvoiceSearchItem,
  InvoiceSearchPage,
} from '../../../../../../domain/model/billing/invoice-read-models';
import { IssuedInterval } from '../../../../../../domain/model/billing/issued-date-range';
import { ChannelKind } from '../../../../../../domain/model/shared/channel.vo';
import {
  InvoicePageRequest,
  InvoiceQueryPort,
  InvoiceSearchFilter,
} from '../../../../../../domain/ports/out/billing/invoice-query.port';
import { PrismaService } from '../../prisma.service';
import { readOnlyTransaction } from '../settlement/read-only-transaction';
import {
  INVOICE_PUBLICATION_LOCK_KEY,
  INVOICE_PUBLICATION_LOCK_NAMESPACE,
} from './invoice-publication-lock';

const OTA_CHANNEL = 'OTA';
// Carácter de escape de LIKE: el nombre del cliente se busca como texto literal, así que un
// % o un _ escrito por el Administrador no actúa como comodín.
const LIKE_ESCAPE = '!';

interface SearchRow {
  id: string;
  invoice_number: bigint;
  issued_at: Date;
  stay_id: string;
  reservation_ref: string;
  channel: string;
  ota_id: string | null;
  customer_name: string;
  customer_tax_id: string;
  currency: string;
  total_amount: Prisma.Decimal;
}

// Lectura de la tabla invoice para 008. Solo SELECT, cada método en una transacción READ ONLY
// (NFR-004): PostgreSQL rechazaría cualquier escritura. No usa el repositorio de escritura de
// 006 ni lee settlement: 006 copió en invoice todo lo que se consulta.
@Injectable()
export class PrismaInvoiceQueryAdapter implements InvoiceQueryPort {
  constructor(private readonly prisma: PrismaService) {}

  async currentTime(): Promise<Date> {
    return readOnlyTransaction(
      this.prisma,
      async (tx) => {
        // READ COMMITTED: la espera no fija una foto anterior al COMMIT del emisor.
        // El SELECT devuelve un entero, no el tipo void de la función de bloqueo.
        await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock_shared(${INVOICE_PUBLICATION_LOCK_NAMESPACE}::int, ${INVOICE_PUBLICATION_LOCK_KEY}::int)`;
        // now() sería el inicio de esta transacción, anterior a la espera. El corte
        // se toma después y se trunca a la precisión que puede reenviar JavaScript.
        const [row] = await tx.$queryRaw<{ now: Date }[]>`
        SELECT date_trunc('milliseconds', clock_timestamp()) AS now`;
        return row.now;
      },
      Prisma.TransactionIsolationLevel.ReadCommitted,
    );
  }

  // SQL parametrizado: el filtro de nombre necesita LIKE con escape, que el cliente de Prisma
  // no ofrece. Orden total issued_at, invoice_number descendentes (NFR-002), que usa el índice
  // idx_invoice_issued_at. La página y el total salen del mismo filtro, con issued_at <= asOf.
  async search(filter: InvoiceSearchFilter, page: InvoicePageRequest): Promise<InvoiceSearchPage> {
    const where = Prisma.join(conditionsOf(filter), ' AND ');
    const offset = (page.page - 1) * page.pageSize;
    const [rows, [{ total }]] = await readOnlyTransaction(
      this.prisma,
      (tx) =>
        Promise.all([
          tx.$queryRaw<SearchRow[]>`
          SELECT id, invoice_number, issued_at, stay_id, reservation_ref, channel, ota_id,
                 customer_name, customer_tax_id, currency, total_amount
          FROM invoice
          WHERE ${where}
          ORDER BY issued_at DESC, invoice_number DESC
          LIMIT ${page.pageSize}::int OFFSET ${offset}::int`,
          tx.$queryRaw<{ total: bigint }[]>`SELECT count(*) AS total FROM invoice WHERE ${where}`,
        ]),
      Prisma.TransactionIsolationLevel.RepeatableRead,
    );
    return { items: rows.map(toSearchItem), totalItems: Number(total) };
  }

  // Lista blanca de columnas (FR-009): nunca el modelo completo.
  async findDetailById(invoiceId: string): Promise<InvoiceDetail | null> {
    const row = await readOnlyTransaction(this.prisma, (tx) =>
      tx.invoice.findUnique({
        where: { id: invoiceId },
        select: {
          id: true,
          invoiceNumber: true,
          status: true,
          issuedAt: true,
          settlementId: true,
          stayId: true,
          reservationRef: true,
          channel: true,
          otaId: true,
          customerName: true,
          customerTaxId: true,
          currency: true,
          lodgingAmount: true,
          otaCommissionAmount: true,
          netIncome: true,
          vatRateApplied: true,
          vatAmount: true,
          totalAmount: true,
        },
      }),
    );
    if (!row) return null;
    return {
      invoiceId: row.id,
      // BIGINT → number: exacto hasta 2^53, muy por encima de cualquier consecutivo real.
      invoiceNumber: Number(row.invoiceNumber),
      status: row.status,
      issuedAt: row.issuedAt,
      settlementId: row.settlementId,
      stayId: row.stayId,
      reservationRef: row.reservationRef,
      channel: row.channel as ChannelKind,
      otaId: row.otaId,
      customerName: row.customerName,
      customerTaxId: row.customerTaxId,
      currency: row.currency,
      lodgingAmount: row.lodgingAmount.toFixed(2),
      otaCommissionAmount: row.otaCommissionAmount.toFixed(2),
      netIncome: row.netIncome.toFixed(2),
      vatRateApplied: row.vatRateApplied.toFixed(2),
      vatAmount: row.vatAmount.toFixed(2),
      totalAmount: row.totalAmount.toFixed(2),
    };
  }

  // Un grupo por (channel, ota_id): el canal directo tiene ota_id nulo (CHECK
  // invoice_channel_data), así que nunca se mezcla con una OTA (FR-012).
  async summarizeByChannel(interval: IssuedInterval): Promise<ChannelTotals[]> {
    const groups = await readOnlyTransaction(this.prisma, (tx) =>
      tx.invoice.groupBy({
        by: ['channel', 'otaId'],
        where: { issuedAt: { gte: interval.from, lt: interval.before } },
        _count: { _all: true },
        _sum: {
          lodgingAmount: true,
          otaCommissionAmount: true,
          vatAmount: true,
          totalAmount: true,
        },
      }),
    );
    return groups.map((group) => ({
      channel: group.channel as ChannelKind,
      otaId: group.otaId,
      invoiceCount: group._count._all,
      totalLodging: decimalText(group._sum.lodgingAmount),
      totalOtaCommission: decimalText(group._sum.otaCommissionAmount),
      totalVat: decimalText(group._sum.vatAmount),
      totalInvoiced: decimalText(group._sum.totalAmount),
    }));
  }

  // Recorre idx_invoice_channel_issued_at saltando de una OTA a la siguiente (CTE recursiva):
  // lee una entrada por OTA en vez de todas las facturas, que con un GROUP BY o el distinct de
  // Prisma recorrería la tabla completa (NFR-005; medido en T035).
  async listKnownOtaIds(): Promise<string[]> {
    const rows = await readOnlyTransaction(
      this.prisma,
      (tx) =>
        tx.$queryRaw<{ ota_id: string }[]>`
        WITH RECURSIVE known AS (
          (SELECT ota_id FROM invoice
           WHERE channel = ${OTA_CHANNEL} AND ota_id IS NOT NULL
           ORDER BY ota_id LIMIT 1)
          UNION ALL
          SELECT (SELECT next.ota_id FROM invoice next
                  WHERE next.channel = ${OTA_CHANNEL} AND next.ota_id > known.ota_id
                  ORDER BY next.ota_id LIMIT 1)
          FROM known
          WHERE known.ota_id IS NOT NULL
        )
        SELECT ota_id FROM known WHERE ota_id IS NOT NULL`,
    );
    return rows.map((row) => row.ota_id);
  }
}

// Cada criterio recibido se convierte en una condición con su valor como parámetro.
// Las fechas viajan como texto ISO con zona y se convierten a timestamptz en PostgreSQL, para
// no depender de la zona horaria de la sesión.
function conditionsOf(filter: InvoiceSearchFilter): Prisma.Sql[] {
  const conditions = [Prisma.sql`issued_at <= ${filter.asOf.toISOString()}::timestamptz`];
  if (filter.stayId !== undefined) {
    conditions.push(Prisma.sql`stay_id = ${filter.stayId}::uuid`);
  }
  if (filter.reservationRef !== undefined) {
    conditions.push(Prisma.sql`reservation_ref = ${filter.reservationRef}`);
  }
  if (filter.customerName !== undefined) {
    const literal = escapeLike(filter.customerName.value);
    // ILIKE sin comodines = nombre completo sin distinguir mayúsculas; con %…% = parcial.
    // Las dos formas usan el índice GIN de trigramas.
    const pattern = filter.customerName.mode === 'PARTIAL' ? `%${literal}%` : literal;
    conditions.push(Prisma.sql`customer_name ILIKE ${pattern} ESCAPE ${LIKE_ESCAPE}`);
  }
  if (filter.customerTaxId !== undefined) {
    conditions.push(Prisma.sql`customer_tax_id = ${filter.customerTaxId}`);
  }
  if (filter.channel !== undefined) {
    conditions.push(Prisma.sql`channel = ${filter.channel}`);
  }
  if (filter.otaId !== undefined) {
    conditions.push(Prisma.sql`ota_id = ${filter.otaId}`);
  }
  if (filter.issued !== undefined) {
    conditions.push(
      Prisma.sql`issued_at >= ${filter.issued.from.toISOString()}::timestamptz`,
      Prisma.sql`issued_at < ${filter.issued.before.toISOString()}::timestamptz`,
    );
  }
  return conditions;
}

function escapeLike(value: string): string {
  return value.replace(/[!%_]/g, (character) => `${LIKE_ESCAPE}${character}`);
}

function toSearchItem(row: SearchRow): InvoiceSearchItem {
  return {
    invoiceId: row.id,
    invoiceNumber: Number(row.invoice_number),
    issuedAt: row.issued_at,
    stayId: row.stay_id,
    reservationRef: row.reservation_ref,
    channel: row.channel as ChannelKind,
    otaId: row.ota_id,
    customerName: row.customer_name,
    customerTaxId: row.customer_tax_id,
    currency: row.currency,
    totalAmount: new Prisma.Decimal(row.total_amount).toFixed(2),
  };
}

// Un grupo de groupBy siempre tiene al menos una factura, así que la suma nunca es nula; el
// "0.00" es solo por tipo.
function decimalText(value: Prisma.Decimal | null): string {
  return value ? value.toFixed(2) : '0.00';
}
