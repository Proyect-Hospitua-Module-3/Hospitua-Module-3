// Feature 003 · Consultar porcentaje de comisión OTA (T019 y HU2)
// De punta a punta con PostgreSQL: el check-out genera la liquidación Final (007, con Módulo 2
// simulado por HTTP) tal como lo hace 010, y luego Módulo 2 (sin token) y la OTA (con su JWT)
// consultan GET /ota-commission/{otaId}. Comprueba además que Generar liquidación usa el
// porcentaje de la reserva y no el histórico, y que no invoca esta consulta (HU2).
// Las cotizaciones vienen de un doble en memoria, como en la E2E de 008. Necesita
// TEST_DATABASE_URL (base ya migrada); sin ella se omite.
import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../../src/app.module';
import {
  GENERATE_SETTLEMENT_USE_CASE,
  GenerateSettlementUseCase,
} from '../../../src/domain/ports/in/settlement/generate-settlement.use-case';
import {
  OTA_COMMISSION_QUERY,
  OtaCommissionQueryPort,
} from '../../../src/domain/ports/out/ota-commission/ota-commission-query.port';
import { LODGING_QUOTE_QUERY } from '../../../src/domain/ports/out/pricing/lodging-quote-query.port';
import { PrismaService } from '../../../src/infrastructure/adapters/out/persistence/prisma.service';
import { PrismaOtaCommissionQueryAdapter } from '../../../src/infrastructure/adapters/out/persistence/repositories/ota-commission/prisma-ota-commission-query.adapter';
import { Module1HttpFixture } from '../../support/pricing/module1-http-fixture';
import {
  InMemoryLodgingQuotes,
  QUOTE_A,
  storedQuote,
} from '../../support/settlement/fake-settlement-ports';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeWithDatabase = TEST_DATABASE_URL ? describe : describe.skip;

const ROOM_ID = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
const OTA_ID = 'ota-e2e-003';
const OTHER_OTA_ID = 'ota-e2e-003-otra';
const EMPTY_OTA_ID = 'ota-e2e-003-sin-historial';
const RESERVATIONS = ['RES-E2E-003-1', 'RES-E2E-003-2', 'RES-E2E-003-3', 'RES-E2E-003-DIR'];
const STAYS = [1, 2, 3, 4].map((n) => `63000000-0000-4000-8000-00000000000${n}`);
const EVENTS = [1, 2, 3, 4].map((n) => `63100000-0000-4000-8000-00000000000${n}`);

describeWithDatabase('Consultar porcentaje de comisión OTA de punta a punta (007 + PostgreSQL + HTTP)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let moduleTwo: Module1HttpFixture;
  let settlements: GenerateSettlementUseCase;
  let otaToken: string;
  let adminToken: string;
  // Cuenta las lecturas del puerto de 003: Generar liquidación nunca debe llegar a él (HU2).
  let commissionReads = 0;

  async function cleanUp(): Promise<void> {
    await prisma.settlement.deleteMany({ where: { stayId: { in: STAYS } } });
  }

  // El check-out de una habitación tal como lo procesa 010, con la reserva que informa Módulo 2.
  async function checkOut(index: number, reservation: Record<string, unknown>) {
    moduleTwo.setReply({
      status: 200,
      body: { reservationRef: RESERVATIONS[index], quoteIds: [QUOTE_A], ...reservation },
    });
    return settlements.generate({
      eventId: EVENTS[index],
      stayId: STAYS[index],
      reservationRef: RESERVATIONS[index],
      roomId: ROOM_ID,
      categoryRoom: 'DOBLE',
      checkInDate: '2026-12-20',
      checkOutDate: '2026-12-23',
    });
  }

  function otaReservation(otaId: string, otaCommissionPercentage: number) {
    return { channel: 'OTA', otaId, otaConfirmationCode: `E2E-${otaId}`, otaCommissionPercentage };
  }

  const get = (otaId: string, token?: string) => {
    const call = request(app.getHttpServer()).get(`/ota-commission/${otaId}`);
    return token ? call.set('Authorization', `Bearer ${token}`) : call;
  };

  beforeAll(async () => {
    moduleTwo = new Module1HttpFixture();
    await moduleTwo.start();
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    process.env.MODULE2_BASE_URL = moduleTwo.baseUrl;
    process.env.JWT_SECRET ||= 'secreto-solo-para-pruebas';
    process.env.JWT_EXPIRES_IN_SECONDS ||= '3600';

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(LODGING_QUOTE_QUERY)
      .useValue(new InMemoryLodgingQuotes([storedQuote(QUOTE_A, ROOM_ID)]))
      .overrideProvider(OTA_COMMISSION_QUERY)
      .useFactory({
        inject: [PrismaService],
        factory: (prismaService: PrismaService): OtaCommissionQueryPort => {
          const real = new PrismaOtaCommissionQueryAdapter(prismaService);
          return {
            findLatestByOtaId: (otaId) => {
              commissionReads += 1;
              return real.findLatestByOtaId(otaId);
            },
          };
        },
      })
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    settlements = app.get(GENERATE_SETTLEMENT_USE_CASE);
    const jwt = app.get(JwtService);
    otaToken = jwt.sign({ sub: '0b8a4c1e-2d3f-4a5b-8c6d-7e8f9a0b1c2d', role: 'OTA', otaId: OTA_ID });
    adminToken = jwt.sign({ sub: 'f2d3b4a5-6c7d-4e8f-9012-3456789abcde', role: 'Administrador' });
    await cleanUp();

    // Historial: una reserva de la OTA al 15 %, una de otra OTA y una directa.
    await checkOut(0, otaReservation(OTA_ID, 15));
    await checkOut(2, otaReservation(OTHER_OTA_ID, 20));
    await checkOut(3, { channel: null });
  });

  afterAll(async () => {
    if (prisma) await cleanUp();
    await app?.close();
    await moduleTwo?.stop();
  });

  it('HU1 escenario 1: Módulo 2 recibe el porcentaje y la fecha de la liquidación Final, marcado como histórico', async () => {
    const stored = await prisma.settlement.findUniqueOrThrow({ where: { stayId: STAYS[0] } });

    const response = await get(OTA_ID);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      otaId: OTA_ID,
      historical: true,
      percentage: '15.00',
      settlementId: stored.id,
      settlementDate: stored.generatedAt.toISOString(),
    });
  });

  it('HU1 escenario 2: una OTA sin liquidaciones → historical: false, sin porcentaje', async () => {
    const response = await get(EMPTY_OTA_ID);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ otaId: EMPTY_OTA_ID, historical: false });
  });

  it('canal directo → 400 INVALID_QUERY_PARAMS, nunca 0% (FR-006)', async () => {
    const response = await get('DIRECT');

    expect(response.status).toBe(400);
    expect(response.body.errorCode).toBe('INVALID_QUERY_PARAMS');
  });

  it('HU3: la OTA ve su propio porcentaje (200) y no el de otra OTA (403 sin datos)', async () => {
    const own = await get(OTA_ID, otaToken);
    const foreign = await get(OTHER_OTA_ID, otaToken);

    expect(own.status).toBe(200);
    expect(own.body.percentage).toBe('15.00');
    expect(foreign.status).toBe(403);
    expect(foreign.body.errorCode).toBe('FORBIDDEN');
    expect(JSON.stringify(foreign.body)).not.toContain('20.00');
  });

  it('autorización: token inválido → 401; Administrador → 403', async () => {
    expect((await get(OTA_ID, 'no-es-un-jwt')).status).toBe(401);
    expect((await get(OTA_ID, adminToken)).status).toBe(403);
  });

  it('consultas repetidas sin liquidaciones nuevas dan el mismo resultado (FR-008)', async () => {
    const first = await get(OTA_ID);
    const second = await get(OTA_ID);

    expect(second.body).toEqual(first.body);
  });

  it('HU2: la nueva liquidación usa el porcentaje de la reserva (18 %), no el histórico (15 %), sin invocar esta consulta', async () => {
    const before = await get(OTA_ID);
    expect(before.body.percentage).toBe('15.00');
    const readsBefore = commissionReads;

    const settlement = await checkOut(1, otaReservation(OTA_ID, 18));

    // Generar liquidación no leyó el puerto de 003 (BR-004, FR-003, SC-003).
    expect(commissionReads).toBe(readsBefore);
    expect(settlement.otaCommissionPercentage).toBe('18.00');
    // La comisión se calcula con el 18 % de la reserva sobre el hospedaje guardado.
    const stored = await prisma.settlement.findUniqueOrThrow({ where: { stayId: STAYS[1] } });
    expect(stored.otaCommissionPercentage?.toFixed(2)).toBe('18.00');

    // La referencia histórica pasa a ser la nueva liquidación.
    const after = await get(OTA_ID);
    expect(after.body).toMatchObject({ historical: true, percentage: '18.00', settlementId: stored.id });
  });
});
