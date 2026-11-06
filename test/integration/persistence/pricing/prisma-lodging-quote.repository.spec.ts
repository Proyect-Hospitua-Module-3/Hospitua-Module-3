// Feature 005 · Consultar tarifa dinámica (T025, T027, T041)
// Archivo de acceso a datos real contra PostgreSQL. Necesita una base ya migrada:
//   TEST_DATABASE_URL=... npx prisma migrate deploy   (con DATABASE_URL apuntando a ella)
//   TEST_DATABASE_URL=... npm test
// Sin TEST_DATABASE_URL estas pruebas se omiten. ¡Borra las cotizaciones de esa base!
import { BaseRate } from '../../../../src/domain/model/pricing/base-rate';
import { CalendarDate } from '../../../../src/domain/model/pricing/calendar-date.vo';
import { DynamicRate } from '../../../../src/domain/model/pricing/dynamic-rate';
import { LodgingQuote } from '../../../../src/domain/model/pricing/lodging-quote';
import { SeasonAdjustmentPercent } from '../../../../src/domain/model/pricing/season-adjustment-percent.vo';
import { StayRange } from '../../../../src/domain/model/pricing/stay-range';
import { PrismaService } from '../../../../src/infrastructure/adapters/out/persistence/prisma.service';
import { PrismaLodgingQuoteRepository } from '../../../../src/infrastructure/adapters/out/persistence/repositories/pricing/prisma-lodging-quote.repository';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeWithDatabase = TEST_DATABASE_URL ? describe : describe.skip;

const ROOM_ID = '3f2b8c1e-5a47-4d09-9b6e-1c2d3e4f5a6b';
const QUOTE_A = 'a1f2c3d4-e5b6-4789-8a9b-0c1d2e3f4a5b';
const QUOTE_B = 'b2e3d4c5-f6a7-4890-9bac-1d2e3f4a5b6c';
const MISSING = 'c3d4e5f6-a7b8-4901-8cbd-2e3f4a5b6c7d';

function night(date: string, seasonName: string, adjustment: string, baseRate = '300000.00') {
  return DynamicRate.compute({
    date: CalendarDate.of(date),
    baseRate: BaseRate.create(baseRate),
    seasonName,
    adjustmentPercent: SeasonAdjustmentPercent.of(adjustment),
  });
}

function quote(quoteId: string): LodgingQuote {
  return LodgingQuote.create({
    quoteId,
    roomId: ROOM_ID,
    stay: StayRange.of(CalendarDate.of('2026-12-23'), CalendarDate.of('2026-12-26')),
    nights: [
      night('2026-12-23', 'Regular', '0.00'),
      night('2026-12-24', 'Alta', '20.00'),
      night('2026-12-25', 'Semana Santa', '-15.50', '250000.00'),
    ],
  });
}

describeWithDatabase('PrismaLodgingQuoteRepository (PostgreSQL real)', () => {
  let prisma: PrismaService;
  let repository: PrismaLodgingQuoteRepository;

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    prisma = new PrismaService();
    await prisma.$connect();
    repository = new PrismaLodgingQuoteRepository(prisma);
  });

  beforeEach(async () => {
    await prisma.$executeRaw`DELETE FROM lodging_quote_night`;
    await prisma.$executeRaw`DELETE FROM lodging_quote`;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('guarda la cotización con sus noches y la lee tal cual con findByIds (T025, T027)', async () => {
    const created = quote(QUOTE_A);

    await repository.insert(created);
    const [read] = await repository.findByIds([QUOTE_A]);

    // Misma forma que el contrato PORT-find-lodging-quotes-by-ids, sin recalcular nada.
    expect({ ...read }).toEqual({ ...created });
    expect(read.lodgingAmount).toBe('871250.00');
    expect(
      read.nights.map((n) => [n.date, n.baseRate, n.seasonName, n.adjustmentPercent, n.rate]),
    ).toEqual([
      ['2026-12-23', '300000.00', 'Regular', '0.00', '300000.00'],
      ['2026-12-24', '300000.00', 'Alta', '20.00', '360000.00'],
      ['2026-12-25', '250000.00', 'Semana Santa', '-15.50', '211250.00'],
    ]);
  });

  it('guarda en las columnas del plan: fechas DATE, importes numeric y moneda COP (T041)', async () => {
    await repository.insert(quote(QUOTE_A));

    const [row] = await prisma.$queryRaw<
      {
        room_id: string;
        check_in_date: string;
        check_out_date: string;
        currency: string;
        lodging_amount: string;
        created_at: Date;
      }[]
    >`SELECT room_id::text, check_in_date::text, check_out_date::text, currency, lodging_amount::text, created_at
      FROM lodging_quote WHERE id = ${QUOTE_A}::uuid`;
    expect(row).toMatchObject({
      room_id: ROOM_ID,
      check_in_date: '2026-12-23',
      check_out_date: '2026-12-26',
      currency: 'COP',
      lodging_amount: '871250.00',
    });
    expect(row.created_at).toBeInstanceOf(Date);
    const nights = await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM lodging_quote_night WHERE quote_id = ${QUOTE_A}::uuid`;
    expect(Number(nights[0].n)).toBe(3);
  });

  it('un id que no existe o que no es UUID no da error: simplemente no aparece', async () => {
    await repository.insert(quote(QUOTE_A));
    await repository.insert(quote(QUOTE_B));

    const read = await repository.findByIds([QUOTE_B, MISSING, 'no-es-un-uuid', QUOTE_A, QUOTE_A]);

    expect(read.map((q) => q.quoteId).sort()).toEqual([QUOTE_A, QUOTE_B].sort());
    expect(await repository.findByIds([])).toEqual([]);
    expect(await repository.findByIds([MISSING])).toEqual([]);
  });

  it('si falla la inserción de una noche, no queda ninguna parte de la cotización (T025, FR-015)', async () => {
    const created = quote(QUOTE_A);
    // Dos noches con la misma fecha violan la clave (quote_id, night_date).
    const broken = LodgingQuote.restore({
      ...created,
      nights: [created.nights[0], created.nights[0]],
    });

    await expect(repository.insert(broken)).rejects.toBeDefined();

    expect(await repository.findByIds([QUOTE_A])).toEqual([]);
    const rows = await prisma.$queryRaw<
      { n: bigint }[]
    >`SELECT count(*) AS n FROM lodging_quote_night`;
    expect(Number(rows[0].n)).toBe(0);
  });

  it('la base rechaza valores imposibles aunque alguien se salte el dominio (CHECK)', async () => {
    const insertQuote = (checkIn: string, checkOut: string, currency: string, amount: string) =>
      prisma.$executeRaw`
        INSERT INTO lodging_quote (id, room_id, check_in_date, check_out_date, currency, lodging_amount)
        VALUES (gen_random_uuid(), ${ROOM_ID}::uuid, ${checkIn}::date, ${checkOut}::date, ${currency}, ${amount}::numeric)`;

    await expect(insertQuote('2026-12-24', '2026-12-24', 'COP', '1.00')).rejects.toBeDefined();
    await expect(insertQuote('2026-12-24', '2026-12-25', 'USD', '1.00')).rejects.toBeDefined();
    await expect(insertQuote('2026-12-24', '2026-12-25', 'COP', '-1.00')).rejects.toBeDefined();

    await repository.insert(quote(QUOTE_A));
    const insertNight = (baseRate: string, adjustment: string, rate: string) =>
      prisma.$executeRaw`
        INSERT INTO lodging_quote_night (quote_id, night_date, base_rate, season_name, adjustment_percent, rate)
        VALUES (${QUOTE_A}::uuid, '2027-01-01'::date, ${baseRate}::numeric, 'Alta', ${adjustment}::numeric, ${rate}::numeric)`;
    await expect(insertNight('0.00', '0.00', '0.00')).rejects.toBeDefined();
    await expect(insertNight('100.00', '100.01', '200.01')).rejects.toBeDefined();
    await expect(insertNight('100.00', '-10.00', '-1.00')).rejects.toBeDefined();
  });
});
