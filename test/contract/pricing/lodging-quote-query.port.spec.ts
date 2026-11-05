// Feature 005 · Consultar tarifa dinámica
// T027: contrato PORT-find-lodging-quotes-by-ids.md (proveedor 005, consumidor 007).
// Usa el archivo de acceso a datos real de 005 con un PrismaService simulado que guarda
// las filas en memoria con los mismos tipos que devuelve Prisma (Date y Decimal). La
// lectura contra PostgreSQL real está en
// test/integration/persistence/pricing/prisma-lodging-quote.repository.spec.ts.
import { Prisma } from '@prisma/client';
import { CreateLodgingQuoteService } from '../../../src/application/services/pricing/create-lodging-quote.service';
import { DynamicRateCalculator } from '../../../src/application/services/pricing/dynamic-rate-calculator';
import { LodgingQuoteQueryPort } from '../../../src/domain/ports/out/pricing/lodging-quote-query.port';
import { LodgingQuoteRow } from '../../../src/infrastructure/adapters/out/persistence/mappers/pricing/lodging-quote.mapper';
import { PrismaService } from '../../../src/infrastructure/adapters/out/persistence/prisma.service';
import { PrismaLodgingQuoteRepository } from '../../../src/infrastructure/adapters/out/persistence/repositories/pricing/prisma-lodging-quote.repository';
import {
  ALTA_ID,
  FakeBaseRates,
  FakeSeasonCalendar,
  FakeSeasonRules,
} from '../../support/pricing/fake-dynamic-rate-ports';

const ROOM_ID = '3f2b8c1e-5a47-4d09-9b6e-1c2d3e4f5a6b';
const QUOTE_ID = 'a1f2c3d4-e5b6-4789-8a9b-0c1d2e3f4a5b';

// Lo mínimo de Prisma que usa el archivo de acceso a datos: create anidado y findMany.
class InMemoryPrisma {
  rows: LodgingQuoteRow[] = [];
  findManyCalls = 0;
  failure?: Error;

  lodgingQuote = {
    create: async ({ data }: { data: Prisma.LodgingQuoteCreateInput }) => {
      const id = data.id as string;
      const nights = (data.nights?.create ??
        []) as Prisma.LodgingQuoteNightCreateWithoutQuoteInput[];
      this.rows.push({
        id,
        roomId: data.roomId,
        checkInDate: data.checkInDate as Date,
        checkOutDate: data.checkOutDate as Date,
        currency: data.currency,
        lodgingAmount: new Prisma.Decimal(data.lodgingAmount as string),
        createdAt: new Date(),
        nights: nights.map((night) => ({
          quoteId: id,
          nightDate: night.nightDate as Date,
          baseRate: new Prisma.Decimal(night.baseRate as string),
          seasonName: night.seasonName,
          adjustmentPercent: new Prisma.Decimal(night.adjustmentPercent as string),
          rate: new Prisma.Decimal(night.rate as string),
        })),
      });
    },
    findMany: async ({ where }: { where: { id: { in: string[] } } }) => {
      this.findManyCalls += 1;
      if (this.failure) throw this.failure;
      return this.rows.filter((row) => where.id.in.includes(row.id));
    },
  };
}

describe('Contrato LodgingQuoteQueryPort (005 → 007)', () => {
  let prisma: InMemoryPrisma;
  let repository: PrismaLodgingQuoteRepository;
  let port: LodgingQuoteQueryPort;
  let rules: FakeSeasonRules;
  let createQuote: CreateLodgingQuoteService;

  beforeEach(() => {
    prisma = new InMemoryPrisma();
    repository = new PrismaLodgingQuoteRepository(prisma as unknown as PrismaService);
    port = repository;

    rules = new FakeSeasonRules();
    const calendar = new FakeSeasonCalendar();
    calendar.assign(['2026-12-24', '2026-12-25'], ALTA_ID);
    const calculator = new DynamicRateCalculator(new FakeBaseRates(), rules, calendar);
    createQuote = new CreateLodgingQuoteService(calculator, repository, () => QUOTE_ID);
  });

  const quoteExample = () =>
    createQuote.create({ roomId: ROOM_ID, checkInDate: '2026-12-23', checkOutDate: '2026-12-26' });

  it('findByIds recibe una lista de quoteIds', () => {
    expect(port.findByIds.length).toBe(1);
  });

  it('devuelve el ejemplo del contrato con los campos de LodgingQuote y de cada noche', async () => {
    await quoteExample();

    const [quote] = await port.findByIds([QUOTE_ID]);

    expect({ ...quote, nights: quote.nights.map((night) => ({ ...night })) }).toEqual({
      quoteId: QUOTE_ID,
      roomId: ROOM_ID,
      checkInDate: '2026-12-23',
      checkOutDate: '2026-12-26',
      currency: 'COP',
      lodgingAmount: '1020000.00',
      nights: [
        {
          date: '2026-12-23',
          baseRate: '300000.00',
          seasonName: 'Regular',
          adjustmentPercent: '0.00',
          rate: '300000.00',
        },
        {
          date: '2026-12-24',
          baseRate: '300000.00',
          seasonName: 'Alta',
          adjustmentPercent: '20.00',
          rate: '360000.00',
        },
        {
          date: '2026-12-25',
          baseRate: '300000.00',
          seasonName: 'Alta',
          adjustmentPercent: '20.00',
          rate: '360000.00',
        },
      ],
    });
  });

  it('importes, porcentajes y fechas son texto, nunca number ni Date', async () => {
    await quoteExample();

    const [quote] = await port.findByIds([QUOTE_ID]);

    const values = [
      quote.checkInDate,
      quote.checkOutDate,
      quote.lodgingAmount,
      ...quote.nights.flatMap((n) => [n.date, n.baseRate, n.adjustmentPercent, n.rate]),
    ];
    values.forEach((value) => expect(typeof value).toBe('string'));
  });

  it('devuelve los valores tal como se guardaron, aunque después cambie la regla de temporada', async () => {
    const created = await quoteExample();
    rules.setAdjustment(ALTA_ID, '50.00');

    const [quote] = await port.findByIds([QUOTE_ID]);

    expect(quote.lodgingAmount).toBe(created.lodgingAmount);
    expect(quote.nights).toEqual(created.nights);
  });

  it('un quoteId que no existe, o que no es un UUID, no da error: simplemente no aparece', async () => {
    await quoteExample();

    const result = await port.findByIds([
      QUOTE_ID,
      'ffffffff-ffff-4fff-8fff-ffffffffffff',
      'no-es-un-uuid',
    ]);

    expect(result.map((quote) => quote.quoteId)).toEqual([QUOTE_ID]);
  });

  it('una lista vacía devuelve una lista vacía', async () => {
    expect(await port.findByIds([])).toEqual([]);
  });

  it('si la base de datos falla, el error se propaga (nunca devuelve una lista vacía)', async () => {
    prisma.failure = new Error('la base de datos no responde');

    await expect(port.findByIds([QUOTE_ID])).rejects.toThrow('la base de datos no responde');
  });
});
