// Feature 008 · Gestionar facturación (T012, T020, T026, T033)
// Lectura real de facturas contra PostgreSQL. Necesita una base ya migrada:
//   TEST_DATABASE_URL=... npx prisma migrate deploy   (con DATABASE_URL apuntando a ella)
//   TEST_DATABASE_URL=... npm test
// Sin TEST_DATABASE_URL estas pruebas se omiten. Solo crea y borra sus propias liquidaciones
// y facturas (reservas RES-IT-008-*, emitidas en 2001 y con números 9008000001 en adelante,
// lejos del consecutivo real), así que no se cruza con los datos de otras suites.
import { ManageInvoicesService } from '../../../../src/application/services/billing/manage-invoices.service';
import { CustomerMatchMode } from '../../../../src/domain/model/billing/customer-match-mode';
import { issuedIntervalOf } from '../../../../src/domain/model/billing/issued-date-range';
import { NewSettlement } from '../../../../src/domain/model/settlement/settlement';
import { InvoiceSearchFilter } from '../../../../src/domain/ports/out/billing/invoice-query.port';
import { SettlementMapper } from '../../../../src/infrastructure/adapters/out/persistence/mappers/settlement/settlement.mapper';
import { PrismaService } from '../../../../src/infrastructure/adapters/out/persistence/prisma.service';
import { PrismaInvoiceQueryAdapter } from '../../../../src/infrastructure/adapters/out/persistence/repositories/billing/prisma-invoice-query.adapter';
import {
  BILLING_TEST_LOCK_TIMEOUT_MS,
  lockBillingTestDatabase,
} from '../../../support/database/billing-test-database-lock';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeWithDatabase = TEST_DATABASE_URL ? describe : describe.skip;

const PREFIX = 'RES-IT-008-';
const TIME_ZONE = 'America/Bogota';
const OTA_A = 'ota-it-008-a';
const OTA_B = 'ota-it-008-b';
const OTA_OLD = 'ota-it-008-historica';
const ROOM_ID = '5f0e8a47-1b2c-4d3e-9f6a-7b8c9d0e1f23';

interface SeedInvoice {
  reservationRef: string;
  issuedAt: string;
  channel?: 'DIRECT' | 'OTA';
  otaId?: string | null;
  customerName?: string;
  customerTaxId?: string;
  lodgingAmount?: string;
  commission?: string;
}

interface Seeded {
  invoiceId: string;
  settlementId: string;
  stayId: string;
  invoiceNumber: number;
}

let next = 0;
function uuid(prefix: string): string {
  next += 1;
  return `${prefix}-0000-4000-8000-${String(next).padStart(12, '0')}`;
}

// Importes coherentes con los CHECK de 006: total = hospedaje + IVA (19%) y neto = hospedaje −
// comisión. Con hospedajes múltiplos de 100 el IVA es exacto.
function amountsOf(lodging: string, commission: string) {
  const lodgingCents = Math.round(Number(lodging) * 100);
  const commissionCents = Math.round(Number(commission) * 100);
  const vatCents = Math.round(lodgingCents * 0.19);
  const text = (cents: number) => (cents / 100).toFixed(2);
  return {
    lodgingAmount: text(lodgingCents),
    otaCommissionAmount: text(commissionCents),
    netIncome: text(lodgingCents - commissionCents),
    vatRateApplied: '19.00',
    vatAmount: text(vatCents),
    totalAmount: text(lodgingCents + vatCents),
  };
}

describeWithDatabase('PrismaInvoiceQueryAdapter (PostgreSQL real)', () => {
  let prisma: PrismaService;
  let adapter: PrismaInvoiceQueryAdapter;
  let unlockDatabase: () => Promise<void>;
  let invoiceNumber = 9_008_000_000;

  async function seed(spec: SeedInvoice): Promise<Seeded> {
    const channel = spec.channel ?? 'OTA';
    const otaId = channel === 'DIRECT' ? null : (spec.otaId ?? OTA_A);
    const commission = channel === 'DIRECT' ? '0.00' : (spec.commission ?? '112500.00');
    const lodging = spec.lodgingAmount ?? '750000.00';
    const amounts = amountsOf(lodging, commission);
    const settlement: NewSettlement = {
      settlementId: uuid('e8000000'),
      stayId: uuid('e9000000'),
      reservationRef: spec.reservationRef,
      roomId: ROOM_ID,
      categoryRoom: 'DOBLE',
      checkInDate: '2001-03-01',
      checkOutDate: '2001-03-03',
      quoteId: 'a1f2c3d4-e5b6-4789-8a9b-0c1d2e3f4a5b',
      channel,
      otaId,
      otaConfirmationCode: otaId ? 'CONF-008' : null,
      otaCommissionPercentage: otaId ? '15.00' : null,
      currency: 'COP',
      lodgingAmount: amounts.lodgingAmount,
      baseLodgingAmount: amounts.lodgingAmount,
      dynamicAdjustmentAmount: '0.00',
      otaCommissionAmount: amounts.otaCommissionAmount,
      netIncome: amounts.netIncome,
      sourceEventId: '9b1f6d3e-2c4a-4f7b-8e5d-3a1c0b9d8e72',
    };
    await prisma.settlement.create({ data: SettlementMapper.toCreateInput(settlement) });
    invoiceNumber += 1;
    const invoiceId = uuid('e7000000');
    await prisma.invoice.create({
      data: {
        id: invoiceId,
        invoiceNumber: BigInt(invoiceNumber),
        status: 'ISSUED',
        issuedAt: new Date(spec.issuedAt),
        settlementId: settlement.settlementId,
        stayId: settlement.stayId,
        sourceEventId: settlement.sourceEventId,
        reservationRef: spec.reservationRef,
        channel,
        otaId,
        customerName: spec.customerName ?? 'Comercializadora Andina S.A.S.',
        customerTaxId: spec.customerTaxId ?? '900123456-7',
        currency: 'COP',
        ...amounts,
      },
    });
    return {
      invoiceId,
      settlementId: settlement.settlementId,
      stayId: settlement.stayId,
      invoiceNumber,
    };
  }

  async function cleanUp(): Promise<void> {
    await prisma.invoice.deleteMany({ where: { reservationRef: { startsWith: PREFIX } } });
    await prisma.settlement.deleteMany({ where: { reservationRef: { startsWith: PREFIX } } });
  }

  // Solo las facturas de esta suite: el rango de 2001 aísla de las demás.
  function filter(overrides: Partial<InvoiceSearchFilter> = {}): InvoiceSearchFilter {
    return {
      issued: issuedIntervalOf({ issuedFrom: '2001-01-01', issuedTo: '2001-12-31' }, TIME_ZONE),
      asOf: new Date(),
      ...overrides,
    };
  }

  async function numbersOf(
    overrides: Partial<InvoiceSearchFilter>,
    page = { page: 1, pageSize: 100 },
  ): Promise<number[]> {
    const found = await adapter.search(filter(overrides), page);
    return found.items.map((item) => item.invoiceNumber);
  }

  beforeAll(async () => {
    unlockDatabase = await lockBillingTestDatabase(TEST_DATABASE_URL!);
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    prisma = new PrismaService();
    await prisma.$connect();
    adapter = new PrismaInvoiceQueryAdapter(prisma);
    await cleanUp();
  }, BILLING_TEST_LOCK_TIMEOUT_MS);

  afterEach(async () => {
    await cleanUp();
  });

  afterAll(async () => {
    await cleanUp();
    await prisma?.$disconnect();
    await unlockDatabase?.();
  });

  describe('search — HU1 (T012)', () => {
    it('filtra por estancia, reserva, documento, canal y OTA', async () => {
      const ota = await seed({ reservationRef: `${PREFIX}A`, issuedAt: '2001-03-05T15:00:00Z' });
      const other = await seed({
        reservationRef: `${PREFIX}B`,
        issuedAt: '2001-03-06T15:00:00Z',
        otaId: OTA_B,
        customerTaxId: '800111222-3',
      });
      const direct = await seed({
        reservationRef: `${PREFIX}C`,
        issuedAt: '2001-03-07T15:00:00Z',
        channel: 'DIRECT',
      });

      expect(await numbersOf({ stayId: ota.stayId })).toEqual([ota.invoiceNumber]);
      expect(await numbersOf({ stayId: ota.stayId.toUpperCase() })).toEqual([ota.invoiceNumber]);
      expect(await numbersOf({ reservationRef: `${PREFIX}B` })).toEqual([other.invoiceNumber]);
      expect(await numbersOf({ customerTaxId: '800111222-3' })).toEqual([other.invoiceNumber]);
      expect(await numbersOf({ channel: 'DIRECT' })).toEqual([direct.invoiceNumber]);
      expect(await numbersOf({ channel: 'OTA' })).toEqual([other.invoiceNumber, ota.invoiceNumber]);
      expect(await numbersOf({ channel: 'OTA', otaId: OTA_A })).toEqual([ota.invoiceNumber]);
    });

    it('rango + canal: solo las de ese canal emitidas en el rango (HU1 escenario 2)', async () => {
      const inside = await seed({ reservationRef: `${PREFIX}A`, issuedAt: '2001-03-10T15:00:00Z' });
      await seed({ reservationRef: `${PREFIX}B`, issuedAt: '2001-04-10T15:00:00Z' });
      await seed({
        reservationRef: `${PREFIX}C`,
        issuedAt: '2001-03-11T15:00:00Z',
        channel: 'DIRECT',
      });

      const march = issuedIntervalOf(
        { issuedFrom: '2001-03-01', issuedTo: '2001-03-31' },
        TIME_ZONE,
      );
      expect(await numbersOf({ issued: march, channel: 'OTA' })).toEqual([inside.invoiceNumber]);
    });

    it('el rango se aplica en hora de Bogotá: 23:59 del último día entra, 00:00 del siguiente no (NFR-006)', async () => {
      // 2001-03-31 23:59:59.999 en Bogotá = 2001-04-01 04:59:59.999 UTC.
      const lastMinute = await seed({
        reservationRef: `${PREFIX}A`,
        issuedAt: '2001-04-01T04:59:59.999Z',
      });
      // 2001-04-01 00:00 en Bogotá = 2001-04-01 05:00 UTC.
      await seed({ reservationRef: `${PREFIX}B`, issuedAt: '2001-04-01T05:00:00.000Z' });
      // 2001-03-01 00:00 en Bogotá entra; las 23:59 del día anterior no.
      const firstMinute = await seed({
        reservationRef: `${PREFIX}C`,
        issuedAt: '2001-03-01T05:00:00.000Z',
      });
      await seed({ reservationRef: `${PREFIX}D`, issuedAt: '2001-03-01T04:59:59.999Z' });

      const march = issuedIntervalOf(
        { issuedFrom: '2001-03-01', issuedTo: '2001-03-31' },
        TIME_ZONE,
      );
      expect(await numbersOf({ issued: march })).toEqual([
        lastMinute.invoiceNumber,
        firstMinute.invoiceNumber,
      ]);
    });

    describe('nombre del cliente: exacto vs. parcial', () => {
      async function byName(value: string, mode: CustomerMatchMode): Promise<number[]> {
        return numbersOf({ customerName: { value, mode } });
      }

      it('EXACT: nombre completo sin distinguir mayúsculas; nunca un nombre que solo lo contiene', async () => {
        const laura = await seed({
          reservationRef: `${PREFIX}A`,
          issuedAt: '2001-03-05T15:00:00Z',
          customerName: 'Laura Gómez',
        });
        await seed({
          reservationRef: `${PREFIX}B`,
          issuedAt: '2001-03-06T15:00:00Z',
          customerName: 'Laura Gómez Ruiz',
        });

        expect(await byName('laura gómez', 'EXACT')).toEqual([laura.invoiceNumber]);
        expect(await byName('LAURA GÓMEZ', 'EXACT')).toEqual([laura.invoiceNumber]);
        expect(await byName('Laura', 'EXACT')).toEqual([]);
      });

      it('PARTIAL: el texto dentro del nombre, sin distinguir mayúsculas', async () => {
        const andina = await seed({
          reservationRef: `${PREFIX}A`,
          issuedAt: '2001-03-05T15:00:00Z',
          customerName: 'Comercializadora Andina S.A.S.',
        });
        const andes = await seed({
          reservationRef: `${PREFIX}B`,
          issuedAt: '2001-03-06T15:00:00Z',
          customerName: 'Hoteles de los Andes',
        });

        expect(await byName('andina', 'PARTIAL')).toEqual([andina.invoiceNumber]);
        expect(await byName('AND', 'PARTIAL')).toEqual([andes.invoiceNumber, andina.invoiceNumber]);
      });

      it('% y _ se buscan como texto, no como comodines', async () => {
        const percent = await seed({
          reservationRef: `${PREFIX}A`,
          issuedAt: '2001-03-05T15:00:00Z',
          customerName: 'Descuento 100% S.A.S.',
        });
        await seed({
          reservationRef: `${PREFIX}B`,
          issuedAt: '2001-03-06T15:00:00Z',
          customerName: 'Descuento 1000 S.A.S.',
        });

        expect(await byName('100%', 'PARTIAL')).toEqual([percent.invoiceNumber]);
        expect(await byName('Descuento 1_0% S.A.S.', 'EXACT')).toEqual([]);
        expect(await byName('Descuento%', 'EXACT')).toEqual([]);
      });
    });

    it('orden total por fecha y número descendentes, igual en cada ejecución (NFR-002)', async () => {
      const sameTime = '2001-03-05T15:00:00Z';
      const first = await seed({ reservationRef: `${PREFIX}A`, issuedAt: sameTime });
      const second = await seed({ reservationRef: `${PREFIX}B`, issuedAt: sameTime });
      const older = await seed({ reservationRef: `${PREFIX}C`, issuedAt: '2001-03-04T15:00:00Z' });

      const expected = [second.invoiceNumber, first.invoiceNumber, older.invoiceNumber];
      for (let run = 0; run < 3; run++) {
        expect(await numbersOf({})).toEqual(expected);
      }
    });

    it('totalItems cuenta todas las coincidencias aunque haya más que pageSize (FR-007)', async () => {
      const seeded: number[] = [];
      for (let n = 1; n <= 5; n++) {
        const day = String(n).padStart(2, '0');
        seeded.push(
          (await seed({ reservationRef: `${PREFIX}${n}`, issuedAt: `2001-03-${day}T15:00:00Z` }))
            .invoiceNumber,
        );
      }

      const pages = [];
      for (let page = 1; page <= 3; page++) {
        pages.push(await adapter.search(filter(), { page, pageSize: 2 }));
      }

      expect(pages.map((page) => page.totalItems)).toEqual([5, 5, 5]);
      expect(pages.flatMap((page) => page.items.map((item) => item.invoiceNumber))).toEqual(
        [...seeded].reverse(),
      );
    });

    it('una factura emitida entre la página 1 y la 2 no produce repetidos ni saltos con el mismo asOf', async () => {
      // Búsqueda por documento (sin rango de fechas) para que la factura nueva, emitida "ahora",
      // también cumpla el criterio.
      const taxId = '800-IT-008-PAGINAS';
      for (let n = 1; n <= 4; n++) {
        await seed({
          reservationRef: `${PREFIX}${n}`,
          issuedAt: `2001-03-0${n}T15:00:00Z`,
          customerTaxId: taxId,
        });
      }
      const service = new ManageInvoicesService(adapter, TIME_ZONE);
      const query = { customerTaxId: taxId, pageSize: '2' };

      const page1 = await service.search(query);
      // Emitida mientras el Administrador mira la página 1: quedaría primera en el orden.
      await seed({
        reservationRef: `${PREFIX}NUEVA`,
        issuedAt: new Date(page1.asOf.getTime() + 1).toISOString(),
        customerTaxId: taxId,
      });
      const page2 = await service.search({ ...query, page: '2', asOf: page1.asOf.toISOString() });

      const all = [...page1.items, ...page2.items].map((item) => item.reservationRef);
      expect(all).toEqual([`${PREFIX}4`, `${PREFIX}3`, `${PREFIX}2`, `${PREFIX}1`]);
      expect(page2.totalItems).toBe(4);
      // Sin reenviar asOf, la página 2 se desplaza: repite la 3, que ya salió en la página 1.
      const shifted = await service.search({ ...query, page: '2' });
      expect(shifted.items.map((item) => item.reservationRef)).toEqual([
        `${PREFIX}3`,
        `${PREFIX}2`,
      ]);
    });

    it('currentTime es la hora de la base de datos', async () => {
      const before = Date.now();
      const now = await adapter.currentTime();
      expect(Math.abs(now.getTime() - before)).toBeLessThan(60_000);
    });
  });

  describe('findDetailById — HU2 (T020)', () => {
    it('devuelve exactamente lo persistido por 006, con la liquidación de origen', async () => {
      const seeded = await seed({
        reservationRef: `${PREFIX}A`,
        issuedAt: '2001-03-05T15:00:00.123Z',
        lodgingAmount: '750000.00',
        commission: '112500.00',
      });

      const detail = await adapter.findDetailById(seeded.invoiceId);
      const row = await prisma.invoice.findUniqueOrThrow({ where: { id: seeded.invoiceId } });

      expect(detail).toEqual({
        invoiceId: seeded.invoiceId,
        invoiceNumber: seeded.invoiceNumber,
        status: 'ISSUED',
        issuedAt: new Date('2001-03-05T15:00:00.123Z'),
        settlementId: seeded.settlementId,
        stayId: seeded.stayId,
        reservationRef: `${PREFIX}A`,
        channel: 'OTA',
        otaId: OTA_A,
        customerName: 'Comercializadora Andina S.A.S.',
        customerTaxId: '900123456-7',
        currency: 'COP',
        lodgingAmount: '750000.00',
        otaCommissionAmount: '112500.00',
        netIncome: '637500.00',
        vatRateApplied: '19.00',
        vatAmount: '142500.00',
        totalAmount: '892500.00',
      });
      expect(detail?.totalAmount).toBe(row.totalAmount.toFixed(2));
      expect(detail?.vatAmount).toBe(row.vatAmount.toFixed(2));
    });

    it('no trae columnas fuera de la lista blanca (sourceEventId ni datos migratorios)', async () => {
      const seeded = await seed({ reservationRef: `${PREFIX}A`, issuedAt: '2001-03-05T15:00:00Z' });
      const detail = await adapter.findDetailById(seeded.invoiceId);
      expect(Object.keys(detail ?? {})).not.toContain('sourceEventId');
      expect(JSON.stringify(detail)).not.toMatch(/nationality|documentType|visa/i);
    });

    it('id inexistente → null', async () => {
      expect(await adapter.findDetailById('e7000000-0000-4000-8000-999999999999')).toBeNull();
    });
  });

  describe('summarizeByChannel y listKnownOtaIds — HU3 (T026)', () => {
    it('totales por canal iguales a la suma manual, sin mezclar OTA (FR-012, SC-006)', async () => {
      await seed({ reservationRef: `${PREFIX}1`, issuedAt: '2001-03-05T15:00:00Z', otaId: OTA_A });
      await seed({
        reservationRef: `${PREFIX}2`,
        issuedAt: '2001-03-06T15:00:00Z',
        otaId: OTA_A,
        lodgingAmount: '500000.00',
        commission: '50000.00',
      });
      await seed({
        reservationRef: `${PREFIX}3`,
        issuedAt: '2001-03-07T15:00:00Z',
        otaId: OTA_B,
        lodgingAmount: '300000.00',
        commission: '45000.00',
      });
      await seed({
        reservationRef: `${PREFIX}4`,
        issuedAt: '2001-03-08T15:00:00Z',
        channel: 'DIRECT',
        lodgingAmount: '200000.00',
      });

      const march = issuedIntervalOf(
        { issuedFrom: '2001-03-01', issuedTo: '2001-03-31' },
        TIME_ZONE,
      );
      const totals = await adapter.summarizeByChannel(march);
      const byKey = (otaId: string | null) => totals.find((group) => group.otaId === otaId);

      expect(byKey(OTA_A)).toEqual({
        channel: 'OTA',
        otaId: OTA_A,
        invoiceCount: 2,
        totalLodging: '1250000.00',
        totalOtaCommission: '162500.00',
        totalVat: '237500.00',
        totalInvoiced: '1487500.00',
      });
      expect(byKey(OTA_B)).toEqual({
        channel: 'OTA',
        otaId: OTA_B,
        invoiceCount: 1,
        totalLodging: '300000.00',
        totalOtaCommission: '45000.00',
        totalVat: '57000.00',
        totalInvoiced: '357000.00',
      });
      expect(byKey(null)).toEqual({
        channel: 'DIRECT',
        otaId: null,
        invoiceCount: 1,
        totalLodging: '200000.00',
        totalOtaCommission: '0.00',
        totalVat: '38000.00',
        totalInvoiced: '238000.00',
      });
    });

    it('una factura de las 23:59 de Bogotá cuenta en ese día, aunque en UTC sea el siguiente', async () => {
      await seed({ reservationRef: `${PREFIX}A`, issuedAt: '2001-04-01T04:59:00Z' });

      const march31 = issuedIntervalOf(
        { issuedFrom: '2001-03-31', issuedTo: '2001-03-31' },
        TIME_ZONE,
      );
      const april1 = issuedIntervalOf(
        { issuedFrom: '2001-04-01', issuedTo: '2001-04-01' },
        TIME_ZONE,
      );

      expect(
        (await adapter.summarizeByChannel(march31)).find((g) => g.otaId === OTA_A),
      ).toMatchObject({ invoiceCount: 1 });
      expect(
        (await adapter.summarizeByChannel(april1)).find((g) => g.otaId === OTA_A),
      ).toBeUndefined();
    });

    it('listKnownOtaIds incluye toda OTA con facturas históricas, sin el canal directo', async () => {
      await seed({
        reservationRef: `${PREFIX}A`,
        issuedAt: '2001-01-05T15:00:00Z',
        otaId: OTA_OLD,
      });
      await seed({
        reservationRef: `${PREFIX}B`,
        issuedAt: '2001-01-06T15:00:00Z',
        channel: 'DIRECT',
      });

      const known = await adapter.listKnownOtaIds();

      expect(known).toContain(OTA_OLD);
      expect(known).not.toContain(null);
      expect(new Set(known).size).toBe(known.length);
    });

    it('el servicio muestra en cero una OTA histórica sin facturas en el rango (FR-014)', async () => {
      await seed({
        reservationRef: `${PREFIX}A`,
        issuedAt: '2001-01-05T15:00:00Z',
        otaId: OTA_OLD,
      });
      const service = new ManageInvoicesService(adapter, TIME_ZONE);

      const summary = await service.summarizeByChannel({
        issuedFrom: '2001-06-01',
        issuedTo: '2001-06-30',
      });

      expect(summary.channels[0]).toMatchObject({ channel: 'DIRECT' });
      expect(summary.channels.find((channel) => channel.otaId === OTA_OLD)).toEqual({
        channel: 'OTA',
        otaId: OTA_OLD,
        invoiceCount: 0,
        totalLodging: '0.00',
        totalOtaCommission: '0.00',
        totalVat: '0.00',
        totalInvoiced: '0.00',
      });
    });
  });

  it('auditoría de solo lectura: invoice y settlement idénticas antes y después de las tres operaciones (T033, NFR-004)', async () => {
    const seeded = await seed({ reservationRef: `${PREFIX}A`, issuedAt: '2001-03-05T15:00:00Z' });
    await seed({
      reservationRef: `${PREFIX}B`,
      issuedAt: '2001-03-06T15:00:00Z',
      channel: 'DIRECT',
    });
    const snapshot = async () => ({
      invoices: await prisma.invoice.findMany({
        where: { reservationRef: { startsWith: PREFIX } },
        orderBy: { id: 'asc' },
      }),
      settlements: await prisma.settlement.findMany({
        where: { reservationRef: { startsWith: PREFIX } },
        orderBy: { id: 'asc' },
      }),
      counter: await prisma.invoiceNumberCounter.findUnique({ where: { id: 1 } }),
    });
    const before = await snapshot();
    const service = new ManageInvoicesService(adapter, TIME_ZONE);

    await service.search({ issuedFrom: '2001-01-01', issuedTo: '2001-12-31' });
    await service.search({ customerName: 'andina', customerMatch: 'PARTIAL' });
    await service.getDetail(seeded.invoiceId);
    await service.summarizeByChannel({ issuedFrom: '2001-01-01', issuedTo: '2001-12-31' });

    expect(await snapshot()).toEqual(before);
  });
});
