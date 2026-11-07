// Feature 010 · Registrar Check-out
// Repositorio real contra PostgreSQL (T003, T004, T017). Necesita una base ya migrada:
//   TEST_DATABASE_URL=... npx prisma migrate deploy   (con DATABASE_URL apuntando a ella)
//   TEST_DATABASE_URL=... npm test
// Sin TEST_DATABASE_URL estas pruebas se omiten. ¡Borra checkout_event_log de esa base!
import { recognizeCheckoutEnvelope } from '../../../../src/domain/model/checkout-ingestion/checkout-event';
import {
  NewCheckoutEventLog,
  pendingCheckoutEventLog,
} from '../../../../src/domain/model/checkout-ingestion/checkout-event-log';
import { PrismaService } from '../../../../src/infrastructure/adapters/out/persistence/prisma.service';
import { PrismaCheckoutEventLogRepository } from '../../../../src/infrastructure/adapters/out/persistence/repositories/checkout-ingestion/prisma-checkout-event-log.repository';
import { validEnvelope } from '../../../support/checkout-ingestion/checkout-event-fixtures';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeWithDatabase = TEST_DATABASE_URL ? describe : describe.skip;

const EVENT_ID = 'a5d8b76e-3f91-4c22-b88a-9e67d4f91012';

function pending(envelope: Record<string, unknown> = validEnvelope()): NewCheckoutEventLog {
  const recognition = recognizeCheckoutEnvelope(envelope);
  if (!recognition.recognized) throw new Error(recognition.reason);
  return pendingCheckoutEventLog(recognition.envelope);
}

describeWithDatabase('PrismaCheckoutEventLogRepository (PostgreSQL real)', () => {
  let prisma: PrismaService;
  let repository: PrismaCheckoutEventLogRepository;

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    prisma = new PrismaService();
    await prisma.$connect();
    repository = new PrismaCheckoutEventLogRepository(prisma);
  });

  beforeEach(async () => {
    await prisma.$executeRaw`DELETE FROM checkout_event_log`;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('registerIfAbsent crea el registro PENDING con la lista blanca', async () => {
    const created = await repository.registerIfAbsent(pending());

    expect(created).toMatchObject({
      eventId: EVENT_ID,
      eventType: 'CHECK_OUT',
      stayId: 'd1e4c7b8-2a55-4e31-89d2-b0a112233445',
      status: 'PENDING',
      processedAt: null,
    });
    expect(created.occurredAt?.toISOString()).toBe('2026-10-08T11:00:00.000Z');
    expect(created.payload).toEqual({
      stayId: 'd1e4c7b8-2a55-4e31-89d2-b0a112233445',
      reservationRef: 'RES-000123',
      roomId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
      categoryRoom: 'DOBLE',
      checkInDate: '2026-10-05',
      checkOutDate: '2026-10-08',
      has_billing_customer: true,
    });
  });

  it('registerIfAbsent devuelve el registro existente sin duplicarlo', async () => {
    const first = await repository.registerIfAbsent(pending());
    const second = await repository.registerIfAbsent(pending());

    expect(second.id).toBe(first.id);
    expect(await prisma.checkoutEventLog.count()).toBe(1);
  });

  it('dos entregas simultáneas del mismo evento dejan un solo registro', async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, () => repository.registerIfAbsent(pending())),
    );

    expect(new Set(results.map((r) => r.id)).size).toBe(1);
    expect(await prisma.checkoutEventLog.count()).toBe(1);
  });

  it('markProcessed cierra el registro con la nota y processed_at', async () => {
    await repository.registerIfAbsent(pending());
    await repository.markProcessed(EVENT_ID, 'Factura no emitida');

    const row = await prisma.checkoutEventLog.findFirstOrThrow({ where: { eventId: EVENT_ID } });
    expect(row).toMatchObject({ status: 'PROCESSED', resultNote: 'Factura no emitida' });
    expect(row.processedAt).not.toBeNull();
  });

  it.each([
    ['markRejected', 'REJECTED', 'INVALID_CHECKOUT_EVENT'],
    ['markDeadLetter', 'DEAD_LETTER', 'QUOTE_NOT_FOUND'],
  ] as const)('%s registra estado, código y motivo', async (operation, status, code) => {
    await repository.registerIfAbsent(pending());
    await repository[operation](EVENT_ID, code, 'motivo');

    const row = await prisma.checkoutEventLog.findFirstOrThrow({ where: { eventId: EVENT_ID } });
    expect(row).toMatchObject({ status, errorCode: code, reason: 'motivo' });
    expect(row.processedAt).not.toBeNull();
  });

  it('una transición sobre un registro ya final no lo cambia', async () => {
    await repository.registerIfAbsent(pending());
    await repository.markProcessed(EVENT_ID);
    await repository.markDeadLetter(EVENT_ID, 'QUOTE_NOT_FOUND', 'tarde');

    const row = await prisma.checkoutEventLog.findFirstOrThrow({ where: { eventId: EVENT_ID } });
    expect(row.status).toBe('PROCESSED');
    expect(row.errorCode).toBeNull();
  });

  it('registra el rechazo de un sobre no reconocible sin event_id ni payload', async () => {
    await repository.registerUnrecognizedEnvelopeRejection('El cuerpo no es JSON válido.');
    await repository.registerUnrecognizedEnvelopeRejection('Otro sobre roto.');

    const rows = await prisma.checkoutEventLog.findMany();
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row).toMatchObject({
        eventId: null,
        payload: null,
        status: 'REJECTED',
        errorCode: 'INVALID_CHECKOUT_EVENT',
      });
      expect(row.processedAt).not.toBeNull();
    }
  });

  it('nunca persiste datos tributarios ni migratorios (T017)', async () => {
    const envelope = validEnvelope();
    envelope.payload.guests = [{ documentNumber: 'X123', nationality: 'VE' }];
    await repository.registerIfAbsent(pending(envelope));

    const [row] = await prisma.$queryRaw<{ payload: string }[]>`
      SELECT payload::text AS payload FROM checkout_event_log`;
    expect(row.payload).not.toContain('Comercializadora');
    expect(row.payload).not.toContain('900123456-7');
    expect(row.payload).not.toContain('X123');
    expect(JSON.parse(row.payload).has_billing_customer).toBe(true);
  });

  it('las restricciones de la migración impiden estados incoherentes', async () => {
    await expect(
      prisma.$executeRaw`INSERT INTO checkout_event_log (status) VALUES ('OTRO')`,
    ).rejects.toThrow();
    await expect(
      prisma.$executeRaw`INSERT INTO checkout_event_log (status, processed_at)
                         VALUES ('PENDING', clock_timestamp())`,
    ).rejects.toThrow();
    await expect(
      prisma.$executeRaw`INSERT INTO checkout_event_log (event_id, status, processed_at)
                         VALUES (gen_random_uuid(), 'DEAD_LETTER', clock_timestamp())`,
    ).rejects.toThrow();
  });
});
