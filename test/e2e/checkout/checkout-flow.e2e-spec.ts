// Feature 010 · Registrar Check-out (T009, T018)
// De punta a punta con la infraestructura real: AppModule completo, RabbitMQ y PostgreSQL.
// Se publica el evento en hospitua.events como lo haría Módulo 1 y se espera a que la
// auditoría deje de estar PENDING. Módulo 2 se simula por HTTP; las cotizaciones y el IVA
// vienen de dobles en memoria para no depender de tablas que otras suites modifican.
// Necesita las dos variables (sin ellas se omite):
//   TEST_DATABASE_URL=... (base ya migrada)  TEST_RABBITMQ_URL=amqp://hospitua:hospitua@localhost:5672
// ¡Vacía las colas modulo3.checkout* de ese broker!
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Channel, ChannelModel, connect } from 'amqplib';
import { AppModule } from '../../../src/app.module';
import { VatRate } from '../../../src/domain/model/billing/vat-rate';
import { VatRateValue } from '../../../src/domain/model/billing/vat-rate-value.vo';
import { VAT_RATE_REPOSITORY } from '../../../src/domain/ports/out/billing/vat-rate.repository.port';
import { LODGING_QUOTE_QUERY } from '../../../src/domain/ports/out/pricing/lodging-quote-query.port';
import { PrismaService } from '../../../src/infrastructure/adapters/out/persistence/prisma.service';
import {
  assertCheckoutTopology,
  CHECKOUT_DEAD_LETTER_QUEUE,
  CHECKOUT_QUEUE,
  CHECKOUT_RETRY_QUEUE,
  CHECKOUT_ROUTING_KEY,
  HOSPITUA_EVENTS_EXCHANGE,
} from '../../../src/infrastructure/config/rabbitmq.config';
import { InMemoryVatRateRepository } from '../../support/billing/in-memory-vat-rate.repository';
import { toBody, validEnvelope } from '../../support/checkout-ingestion/checkout-event-fixtures';
import { Module1HttpFixture } from '../../support/pricing/module1-http-fixture';
import {
  InMemoryLodgingQuotes,
  QUOTE_A,
  storedQuote,
} from '../../support/settlement/fake-settlement-ports';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const TEST_RABBITMQ_URL = process.env.TEST_RABBITMQ_URL;
const describeWithInfrastructure =
  TEST_DATABASE_URL && TEST_RABBITMQ_URL ? describe : describe.skip;

const ROOM_ID = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
const STAYS = [1, 2, 3].map((n) => `64000000-0000-4000-8000-00000000000${n}`);
const EVENTS = [1, 2, 3].map((n) => `65000000-0000-4000-8000-00000000000${n}`);
const QUEUES = [CHECKOUT_QUEUE, CHECKOUT_RETRY_QUEUE, CHECKOUT_DEAD_LETTER_QUEUE];

function checkoutEvent(index: number, billingCustomer?: unknown): Record<string, any> {
  const envelope = validEnvelope();
  envelope.eventId = EVENTS[index];
  envelope.payload.stayId = STAYS[index];
  if (billingCustomer !== undefined) envelope.payload.billingCustomer = billingCustomer;
  return envelope;
}

describeWithInfrastructure('Check-out de punta a punta (RabbitMQ + PostgreSQL + AppModule)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let moduleTwo: Module1HttpFixture;
  let broker: ChannelModel;
  let channel: Channel;

  async function cleanUp(): Promise<void> {
    await prisma.checkoutEventLog.deleteMany({ where: { eventId: { in: EVENTS } } });
    await prisma.invoice.deleteMany({ where: { stayId: { in: STAYS } } });
    await prisma.settlement.deleteMany({ where: { stayId: { in: STAYS } } });
  }

  async function publish(envelope: Record<string, any>): Promise<void> {
    channel.publish(HOSPITUA_EVENTS_EXCHANGE, CHECKOUT_ROUTING_KEY, Buffer.from(toBody(envelope)), {
      persistent: true,
      contentType: 'application/json',
    });
  }

  async function finalStatusOf(eventId: string): Promise<string> {
    for (let attempt = 0; attempt < 100; attempt++) {
      const log = await prisma.checkoutEventLog.findFirst({ where: { eventId } });
      if (log && log.status !== 'PENDING') return log.status;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`El evento ${eventId} no terminó de procesarse`);
  }

  beforeAll(async () => {
    moduleTwo = new Module1HttpFixture();
    await moduleTwo.start();
    moduleTwo.setReply({
      status: 200,
      body: { reservationRef: 'RES-000123', quoteIds: [QUOTE_A], channel: null },
    });
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    process.env.RABBITMQ_URL = TEST_RABBITMQ_URL;
    process.env.MODULE2_BASE_URL = moduleTwo.baseUrl;

    broker = await connect(TEST_RABBITMQ_URL!);
    channel = await broker.createChannel();
    await assertCheckoutTopology(channel);
    for (const queue of QUEUES) await channel.purgeQueue(queue);

    const vatRates = new InMemoryVatRateRepository();
    vatRates.current = new VatRate(VatRateValue.of('19.00'), 'admin', new Date());
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(VAT_RATE_REPOSITORY)
      .useValue(vatRates)
      .overrideProvider(LODGING_QUOTE_QUERY)
      .useValue(new InMemoryLodgingQuotes([storedQuote(QUOTE_A, ROOM_ID)]))
      .compile();
    app = moduleRef.createNestApplication();
    app.enableShutdownHooks();
    await app.init();
    prisma = app.get(PrismaService);
    await cleanUp();
  });

  afterAll(async () => {
    await cleanUp();
    await app?.close();
    for (const queue of QUEUES) await channel?.purgeQueue(queue);
    await broker?.close();
    await moduleTwo?.stop();
  });

  it('el evento de Módulo 1 termina en liquidación Final y factura emitida (HU1)', async () => {
    await publish(checkoutEvent(0));

    await expect(finalStatusOf(EVENTS[0])).resolves.toBe('PROCESSED');
    const settlement = await prisma.settlement.findUniqueOrThrow({ where: { stayId: STAYS[0] } });
    const invoice = await prisma.invoice.findUniqueOrThrow({ where: { stayId: STAYS[0] } });
    expect(invoice.settlementId).toBe(settlement.id);
    expect(invoice.totalAmount.toFixed(2)).toBe('892500.00');
  });

  it('sin datos tributarios: PROCESSED con nota, liquidación sin factura', async () => {
    await publish(checkoutEvent(1, null));

    await expect(finalStatusOf(EVENTS[1])).resolves.toBe('PROCESSED');
    const log = await prisma.checkoutEventLog.findFirstOrThrow({ where: { eventId: EVENTS[1] } });
    expect(log.resultNote).toBe('Factura no emitida: datos tributarios ausentes o incompletos');
    expect(JSON.stringify(log.payload)).not.toContain('900123456-7');
    await expect(prisma.settlement.count({ where: { stayId: STAYS[1] } })).resolves.toBe(1);
    await expect(prisma.invoice.count({ where: { stayId: STAYS[1] } })).resolves.toBe(0);
  });

  it('Módulo 2 caído: el evento va a la cola de reintento con x-retry-count 1 (T018)', async () => {
    moduleTwo.setReply({ status: 503, body: {} });

    await publish(checkoutEvent(2));

    let retried = null;
    for (let attempt = 0; attempt < 100 && !retried; attempt++) {
      retried = await channel.get(CHECKOUT_RETRY_QUEUE, { noAck: true });
      if (!retried) await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(retried).not.toBeNull();
    expect(retried && retried.properties.headers?.['x-retry-count']).toBe(1);
    const log = await prisma.checkoutEventLog.findFirstOrThrow({ where: { eventId: EVENTS[2] } });
    expect(log.status).toBe('PENDING');
    await expect(prisma.settlement.count({ where: { stayId: STAYS[2] } })).resolves.toBe(0);
  });
});
