// Feature 006 · Generar factura final
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { InvoicePersistenceUnavailableError } from '../../../../../../domain/errors/billing/invoice-persistence-unavailable.error';
import { Invoice, InvoiceDraft } from '../../../../../../domain/model/billing/invoice';
import { InvoiceIssuanceRepositoryPort } from '../../../../../../domain/ports/out/billing/invoice-issuance.repository.port';
import { InvoiceMapper } from '../../mappers/billing/invoice.mapper';
import { PrismaService } from '../../prisma.service';
import { isTransientPersistenceError } from '../../transient-persistence-error';

// `invoice_number_counter` es de fila única: siempre id = 1 (lo exige un CHECK en la migración).
const COUNTER_ROW_ID = 1;

// Violación de una restricción UNIQUE en Prisma.
const UNIQUE_VIOLATION = 'P2002';

interface CounterRow {
  last_number: bigint;
}

// Archivo de acceso a datos de las facturas. Solo INSERT y SELECT sobre invoice: no hay
// ningún UPDATE ni DELETE, porque la factura es inmutable (FR-006). El único UPDATE es el
// del consecutivo, dentro de la transacción que emite.
@Injectable()
export class PrismaInvoiceIssuanceRepository implements InvoiceIssuanceRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async findByStayId(stayId: string): Promise<Invoice | null> {
    try {
      const row = await this.prisma.invoice.findUnique({ where: { stayId } });
      return row ? InvoiceMapper.toDomain(row) : null;
    } catch (error) {
      throw asPersistenceError(error);
    }
  }

  async issueIfAbsent(draft: InvoiceDraft): Promise<Invoice> {
    try {
      return await this.issueInTransaction(draft);
    } catch (error) {
      // Defensa final: con el bloqueo no debería ocurrir, pero si una UNIQUE salta es que la
      // factura ya existe y se devuelve esa (FR-007).
      if (isUniqueViolation(error)) {
        const winner = await this.findExisting(draft);
        if (winner) return winner;
      }
      throw asPersistenceError(error);
    }
  }

  // READ COMMITTED (el predeterminado) + SELECT … FOR UPDATE: el bloqueo de la fila del
  // consecutivo serializa las emisiones, y cada sentencia posterior ve lo que confirmó la
  // emisión anterior. SERIALIZABLE haría fallar con 40001 en vez de esperar.
  // Ni 001 ni 007 se llaman aquí dentro: la transacción solo cubre la sección crítica.
  private issueInTransaction(draft: InvoiceDraft): Promise<Invoice> {
    return this.prisma.$transaction(
      async (tx) => {
        const [counter] = await tx.$queryRaw<CounterRow[]>`
          SELECT last_number FROM invoice_number_counter WHERE id = ${COUNTER_ROW_ID} FOR UPDATE`;
        if (!counter) {
          throw new Error(
            'Falta la fila del consecutivo de facturas (invoice_number_counter); revisa la migración create_invoice.',
          );
        }

        // Segundo chequeo bajo el bloqueo: otra entrega pudo emitir mientras se esperaba.
        const existing = await tx.invoice.findFirst({
          where: { OR: [{ stayId: draft.stayId }, { settlementId: draft.settlementId }] },
        });
        if (existing) return InvoiceMapper.toDomain(existing);

        const invoiceNumber = BigInt(counter.last_number) + BigInt(1);
        await tx.$executeRaw`
          UPDATE invoice_number_counter SET last_number = ${invoiceNumber} WHERE id = ${COUNTER_ROW_ID}`;
        const row = await tx.invoice.create({
          data: InvoiceMapper.toCreateInput(draft, invoiceNumber),
        });
        return InvoiceMapper.toDomain(row);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );
  }

  private async findExisting(draft: InvoiceDraft): Promise<Invoice | null> {
    try {
      const row = await this.prisma.invoice.findFirst({
        where: { OR: [{ stayId: draft.stayId }, { settlementId: draft.settlementId }] },
      });
      return row ? InvoiceMapper.toDomain(row) : null;
    } catch (error) {
      throw asPersistenceError(error);
    }
  }
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === UNIQUE_VIOLATION;
}

// Un fallo transitorio sale como DATABASE_UNAVAILABLE (reintentable); cualquier otro se
// propaga tal cual y 010 lo trata como inesperado.
function asPersistenceError(error: unknown): unknown {
  return isTransientPersistenceError(error) ? new InvoicePersistenceUnavailableError(error) : error;
}
