import { PrismaClient } from '@prisma/client';

// Las suites de integración de facturación (006) emiten facturas reales y comparan el
// consecutivo global (invoice_number_counter) antes y después de emitir. Jest corre los
// archivos en paralelo: si la otra suite emite en medio, el contador queda adelantado.
// Se turnan con un bloqueo de sesión sobre la base de pruebas.
// La clave es distinta del 1001 del IVA de 001, del 3_011_009 de pricing y del par
// (11, año) del calendario.
const BILLING_TEST_LOCK_KEY = 3_006_007;

// Tiempo para esperar a que termine la otra suite (úsalo como timeout del beforeAll).
export const BILLING_TEST_LOCK_TIMEOUT_MS = 180_000;

// Toma el bloqueo y devuelve la función que lo libera. Usa un cliente propio de una sola
// conexión: un bloqueo de sesión se libera en la misma conexión que lo tomó.
export async function lockBillingTestDatabase(databaseUrl: string): Promise<() => Promise<void>> {
  const url = new URL(databaseUrl);
  url.searchParams.set('connection_limit', '1');
  const client = new PrismaClient({ datasources: { db: { url: url.toString() } } });
  await client.$connect();
  await client.$executeRaw`SELECT pg_advisory_lock(${BILLING_TEST_LOCK_KEY}::bigint)`;
  return async () => {
    await client.$executeRaw`SELECT pg_advisory_unlock(${BILLING_TEST_LOCK_KEY}::bigint)`;
    await client.$disconnect();
  };
}
