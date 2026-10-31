// Feature 001 · Actualizar porcentaje de IVA
// Repositorio real contra PostgreSQL (T015, T023, T024). Necesita una base ya migrada:
//   TEST_DATABASE_URL=... npx prisma migrate deploy   (con DATABASE_URL apuntando a ella)
//   TEST_DATABASE_URL=... npm test
// Sin TEST_DATABASE_URL estas pruebas se omiten. ¡Borra los datos de IVA de esa base!
import { VatRateValue } from '../../../../src/domain/model/billing/vat-rate-value.vo';
import { PrismaService } from '../../../../src/infrastructure/adapters/out/persistence/prisma.service';
import { PrismaVatRateRepository } from '../../../../src/infrastructure/adapters/out/persistence/repositories/billing/prisma-vat-rate.repository';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeWithDatabase = TEST_DATABASE_URL ? describe : describe.skip;

const ADMIN_ID = 'f2d3b4a5-6c7d-4e8f-9012-3456789abcde';

describeWithDatabase('PrismaVatRateRepository (PostgreSQL real)', () => {
  let prisma: PrismaService;
  let repository: PrismaVatRateRepository;

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    prisma = new PrismaService();
    await prisma.$connect();
    repository = new PrismaVatRateRepository(prisma);
  });

  beforeEach(async () => {
    await prisma.$executeRaw`DELETE FROM vat_rate_history`;
    await prisma.$executeRaw`DELETE FROM vat_rate`;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function historyRows() {
    return prisma.vatRateHistory.findMany();
  }

  it('sin ningún porcentaje, getCurrent devuelve null (T024)', async () => {
    expect(await repository.getCurrent()).toBeNull();
  });

  it('el primer registro deja value_before nulo (T024)', async () => {
    const saved = await repository.saveNew(VatRateValue.of('19'), ADMIN_ID);

    expect(saved.value.toString()).toBe('19.00');
    const [entry] = await historyRows();
    expect(entry.valueBefore).toBeNull();
    expect(entry.valueAfter.toFixed(2)).toBe('19.00');
    expect(entry.changedAt.getTime()).toBe(saved.updatedAt.getTime());

    // Misma hora exacta en las dos tablas, con microsegundos (JavaScript solo ve milisegundos).
    const [{ same }] = await prisma.$queryRaw<{ same: boolean }[]>`
      SELECT h.changed_at = v.updated_at AS same
      FROM vat_rate_history h CROSS JOIN vat_rate v`;
    expect(same).toBe(true);
  });

  it('un valor idéntico al vigente también deja historial (T023)', async () => {
    await repository.saveNew(VatRateValue.of('19'), ADMIN_ID);
    await repository.saveNew(VatRateValue.of('19.00'), ADMIN_ID);

    expect(await historyRows()).toHaveLength(2);
  });

  it('si el historial falla, el vigente no cambia (T022)', async () => {
    await repository.saveNew(VatRateValue.of('19'), ADMIN_ID);

    // Restricción temporal que solo rechaza la entrada de historial con valor 7: el
    // vigente sí llega a escribirse y es el insert del historial el que falla después.
    await prisma.$executeRawUnsafe(
      'ALTER TABLE vat_rate_history ADD CONSTRAINT test_rechaza_siete CHECK (value_after <> 7)',
    );
    try {
      await expect(repository.saveNew(VatRateValue.of('7'), ADMIN_ID)).rejects.toThrow();
    } finally {
      await prisma.$executeRawUnsafe(
        'ALTER TABLE vat_rate_history DROP CONSTRAINT test_rechaza_siete',
      );
    }

    // La transacción revirtió también el cambio del vigente.
    expect((await repository.getCurrent())?.value.toString()).toBe('19.00');
    expect(await historyRows()).toHaveLength(1);
  });

  it('actualizaciones concurrentes quedan en una secuencia coherente (T015)', async () => {
    const values = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'];

    // Incluye el caso de la tabla vacía: todas compiten por el primer registro.
    await Promise.all(values.map((v) => repository.saveNew(VatRateValue.of(v), ADMIN_ID)));

    const history = await historyRows();
    expect(history).toHaveLength(values.length);

    // Reconstruye la cadena: cada value_before es el value_after de la anterior.
    let previous: string | null = null;
    const remaining = history.map((h) => ({
      before: h.valueBefore?.toFixed(2) ?? null,
      after: h.valueAfter.toFixed(2),
    }));
    while (remaining.length > 0) {
      const index = remaining.findIndex((h) => h.before === previous);
      expect(index).toBeGreaterThanOrEqual(0);
      previous = remaining.splice(index, 1)[0].after;
    }

    // El vigente es el último eslabón: nunca un estado mixto.
    expect((await repository.getCurrent())?.value.toString()).toBe(previous);
  });
});
