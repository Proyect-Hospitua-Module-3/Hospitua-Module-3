// Feature 007 · Generar liquidación (T031, T033)
// Flujo real de generate: cliente HTTP de Módulo 2 contra un servidor simulado y
// liquidaciones en PostgreSQL. Las cotizaciones vienen de un doble en memoria para no
// depender de las tablas de 005, que otras suites borran.
// Necesita TEST_DATABASE_URL (ver prisma-settlement.repository.spec.ts); sin ella se omite.
import { HttpModule } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { GenerateSettlementService } from '../../../src/application/services/settlement/generate-settlement.service';
import { Module2ReservationClient } from '../../../src/infrastructure/adapters/out/http/module2-reservation.client';
import { PrismaService } from '../../../src/infrastructure/adapters/out/persistence/prisma.service';
import { PrismaSettlementRepository } from '../../../src/infrastructure/adapters/out/persistence/repositories/settlement/prisma-settlement.repository';
import { Module1HttpFixture } from '../../support/pricing/module1-http-fixture';
import {
  checkoutCommand,
  InMemoryLodgingQuotes,
  QUOTE_A,
  RESERVATION_REF,
} from '../../support/settlement/fake-settlement-ports';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeWithDatabase = TEST_DATABASE_URL ? describe : describe.skip;

const STAY_FLOW = '72000000-0000-4000-8000-000000000001';
const STAY_RACE = '72000000-0000-4000-8000-000000000002';
const STAY_DOWN = '72000000-0000-4000-8000-000000000003';
const OWN_STAYS = [STAY_FLOW, STAY_RACE, STAY_DOWN];

// Objetivo de Módulo 1 para GET /api/settlements, que reutiliza este cálculo (NFR-002).
const GENERATION_BUDGET_MS = 800;

const OTA_RESERVATION = {
  reservationRef: RESERVATION_REF,
  quoteIds: [QUOTE_A],
  channel: 'OTA',
  otaId: 'booking',
  otaConfirmationCode: 'BKG-88421',
  otaCommissionPercentage: 15,
};

describeWithDatabase('GenerateSettlement de punta a punta (Módulo 2 simulado + PostgreSQL)', () => {
  let prisma: PrismaService;
  let fixture: Module1HttpFixture;
  let moduleRef: TestingModule;
  let service: GenerateSettlementService;

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    prisma = new PrismaService();
    await prisma.$connect();
  });

  beforeEach(async () => {
    await prisma.settlement.deleteMany({ where: { stayId: { in: OWN_STAYS } } });
    fixture = new Module1HttpFixture();
    await fixture.start();
    fixture.setReply({ status: 200, body: OTA_RESERVATION });
    moduleRef = await Test.createTestingModule({
      imports: [HttpModule.register({})],
      providers: [
        Module2ReservationClient,
        {
          provide: ConfigService,
          useValue: {
            get: (name: string) =>
              name === 'MODULE2_BASE_URL'
                ? fixture.baseUrl
                : name === 'MODULE2_TIMEOUT_MS'
                  ? '500'
                  : undefined,
          },
        },
      ],
    }).compile();
    service = new GenerateSettlementService(
      moduleRef.get(Module2ReservationClient),
      new InMemoryLodgingQuotes(),
      new PrismaSettlementRepository(prisma),
    );
  });

  afterEach(async () => {
    await moduleRef?.close();
    await fixture.stop();
  });

  afterAll(async () => {
    await prisma.settlement.deleteMany({ where: { stayId: { in: OWN_STAYS } } });
    await prisma.$disconnect();
  });

  it('genera y guarda la liquidación OTA del ejemplo del contrato', async () => {
    const settlement = await service.generate(checkoutCommand({ stayId: STAY_FLOW }));

    expect(settlement).toMatchObject({
      status: 'FINAL',
      quoteId: QUOTE_A,
      lodgingAmount: '750000.00',
      otaCommissionAmount: '112500.00',
      netIncome: '637500.00',
    });
    await expect(prisma.settlement.count({ where: { stayId: STAY_FLOW } })).resolves.toBe(1);
  });

  it('un reenvío no cambia la fila guardada ni vuelve a consultar Módulo 2 (T031, FR-009)', async () => {
    await service.generate(checkoutCommand({ stayId: STAY_FLOW }));
    const before = await prisma.settlement.findUnique({ where: { stayId: STAY_FLOW } });
    // Aunque Módulo 2 cambie la comisión, la liquidación Final no se recalcula.
    fixture.setReply({ status: 200, body: { ...OTA_RESERVATION, otaCommissionPercentage: 20 } });

    const resent = await service.generate(checkoutCommand({ stayId: STAY_FLOW }));
    const after = await prisma.settlement.findUnique({ where: { stayId: STAY_FLOW } });

    expect(after).toEqual(before);
    expect(resent.netIncome).toBe('637500.00');
    expect(fixture.requests).toBe(1);
  });

  it('dos entregas simultáneas del mismo check-out devuelven la misma liquidación (FR-011)', async () => {
    const command = checkoutCommand({ stayId: STAY_RACE });

    const [first, second] = await Promise.all([
      service.generate(command),
      service.generate(command),
    ]);

    expect(second.settlementId).toBe(first.settlementId);
    await expect(prisma.settlement.count({ where: { stayId: STAY_RACE } })).resolves.toBe(1);
  });

  it('con Módulo 2 caído no guarda nada (FR-021)', async () => {
    fixture.setReply({ status: 503, body: {} });

    await expect(service.generate(checkoutCommand({ stayId: STAY_DOWN }))).rejects.toMatchObject({
      errorCode: 'MODULE2_UNAVAILABLE',
    });
    await expect(prisma.settlement.count({ where: { stayId: STAY_DOWN } })).resolves.toBe(0);
  });

  it(`cabe en ${GENERATION_BUDGET_MS} ms con Módulo 2 tardando 200 ms (T033, NFR-002)`, async () => {
    fixture.setReply({ status: 200, body: OTA_RESERVATION, delayMs: 200 });
    const startedAt = performance.now();

    await service.generate(checkoutCommand({ stayId: STAY_FLOW }));

    expect(performance.now() - startedAt).toBeLessThan(GENERATION_BUDGET_MS);
  });
});
