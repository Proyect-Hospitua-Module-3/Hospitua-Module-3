import { PrismaClient } from '@prisma/client';

// Las suites de integración de pricing (009 y 011) borran y recrean las mismas tablas
// (season, season_rule, calendario). Jest corre los archivos en paralelo, así que se
// turnan con un bloqueo de sesión sobre la base de pruebas.
// La clave es distinta del 1001 que usa el IVA de 001 y del par (11, año) del calendario.
const PRICING_TEST_LOCK_KEY = 3_011_009;

// Tiempo para esperar a que termine la otra suite (úsalo como timeout del beforeAll).
export const PRICING_TEST_LOCK_TIMEOUT_MS = 180_000;

// Toma el bloqueo y devuelve la función que lo libera. Usa un cliente propio de una sola
// conexión: un bloqueo de sesión se libera en la misma conexión que lo tomó.
export async function lockPricingTestDatabase(databaseUrl: string): Promise<() => Promise<void>> {
  const url = new URL(databaseUrl);
  url.searchParams.set('connection_limit', '1');
  const client = new PrismaClient({ datasources: { db: { url: url.toString() } } });
  await client.$connect();
  await client.$executeRaw`SELECT pg_advisory_lock(${PRICING_TEST_LOCK_KEY}::bigint)`;
  return async () => {
    await client.$executeRaw`SELECT pg_advisory_unlock(${PRICING_TEST_LOCK_KEY}::bigint)`;
    await client.$disconnect();
  };
}
