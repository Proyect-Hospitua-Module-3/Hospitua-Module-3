// Feature 006 · Generar factura final y Feature 010 · Registrar Check-out
import { Prisma } from '@prisma/client';

// Fallos de conexión, timeout o conflicto de transacción: la base no respondió y se puede
// reintentar. Un CHECK, una FK o un dato inválido no está aquí: reintentar no lo arregla.
const TRANSIENT_ERROR_CODES = new Set([
  'P1001', // no se alcanza el servidor
  'P1002', // el servidor no respondió a tiempo
  'P1008', // timeout de la operación
  'P1017', // el servidor cerró la conexión
  'P2024', // timeout esperando una conexión del pool
  'P2028', // error de la API de transacciones (p. ej. la transacción expiró)
  'P2034', // conflicto de escritura o deadlock
]);

// true si el error de Prisma es una falla transitoria de la base de datos (reintentable).
export function isTransientPersistenceError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientInitializationError ||
    error instanceof Prisma.PrismaClientRustPanicError ||
    (error instanceof Prisma.PrismaClientKnownRequestError && TRANSIENT_ERROR_CODES.has(error.code))
  );
}
