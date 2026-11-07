// Feature 002 · Consultar liquidación
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma.service';

// Ejecuta las lecturas de 002 en una transacción READ ONLY (plan 002, «Consistencia»):
// PostgreSQL rechaza cualquier escritura dentro de ella, así que la consulta no puede
// modificar liquidaciones ni facturas (FR-004, BR-001). SET TRANSACTION tiene que ser la
// primera sentencia de la transacción.
export function readOnlyTransaction<T>(
  prisma: PrismaService,
  read: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    return read(tx);
  });
}
