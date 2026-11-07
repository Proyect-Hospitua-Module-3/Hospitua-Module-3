// Feature 010 · Registrar Check-out (T009, T010, T015, T017, T019)
// Flujo completo con los servicios reales de 010, 007, 006 y 001, y los puertos de salida
// en memoria (Módulo 2, cotizaciones, liquidaciones, IVA, facturas, auditoría y broker).
// No necesita RabbitMQ ni PostgreSQL: corre siempre. El mismo flujo contra la
// infraestructura real está en test/e2e/checkout/checkout-flow.e2e-spec.ts.
import { CheckoutEventProcessorService } from '../../../src/application/services/checkout-ingestion/checkout-event-processor.service';
import { RegisterCheckoutService } from '../../../src/application/services/checkout-ingestion/register-checkout.service';
import { GenerateFinalInvoiceService } from '../../../src/application/services/billing/generate-final-invoice.service';
import { GetCurrentVatRateService } from '../../../src/application/services/billing/get-current-vat-rate.service';
import { GenerateSettlementService } from '../../../src/application/services/settlement/generate-settlement.service';
import { Module2UnavailableError } from '../../../src/domain/errors/settlement/module2-unavailable.error';
import { VatRate } from '../../../src/domain/model/billing/vat-rate';
import { VatRateValue } from '../../../src/domain/model/billing/vat-rate-value.vo';
import { InMemoryInvoiceIssuance } from '../../support/billing/fake-invoice-ports';
import { InMemoryVatRateRepository } from '../../support/billing/in-memory-vat-rate.repository';
import { toBody, validEnvelope } from '../../support/checkout-ingestion/checkout-event-fixtures';
import { FakeCheckoutMessagePublisher } from '../../support/checkout-ingestion/fake-checkout-message-publisher';
import { InMemoryCheckoutEventLogRepository } from '../../support/checkout-ingestion/in-memory-checkout-event-log.repository';
import {
  directReservation,
  FakeReservationClient,
  InMemoryLodgingQuotes,
  InMemorySettlementRepository,
  otaReservation,
  QUOTE_A,
  storedQuote,
} from '../../support/settlement/fake-settlement-ports';

const EVENT_ID = 'a5d8b76e-3f91-4c22-b88a-9e67d4f91012';
const OTHER_EVENT_ID = 'b6e9c87f-4a02-4d33-9c99-0f78e5a02123';
const STAY_ID = 'd1e4c7b8-2a55-4e31-89d2-b0a112233445';
const ROOM_ID = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';

describe('Check-out → liquidación → factura (010 + 007 + 006 + 001, en memoria)', () => {
  let reservations: FakeReservationClient;
  let settlements: InMemorySettlementRepository;
  let vatRates: InMemoryVatRateRepository;
  let invoices: InMemoryInvoiceIssuance;
  let eventLogs: InMemoryCheckoutEventLogRepository;
  let publisher: FakeCheckoutMessagePublisher;
  let service: RegisterCheckoutService;

  beforeEach(() => {
    reservations = new FakeReservationClient(directReservation({ quoteIds: [QUOTE_A] }));
    settlements = new InMemorySettlementRepository();
    vatRates = new InMemoryVatRateRepository();
    vatRates.current = new VatRate(VatRateValue.of('19.00'), 'admin', new Date());
    invoices = new InMemoryInvoiceIssuance();
    eventLogs = new InMemoryCheckoutEventLogRepository();
    publisher = new FakeCheckoutMessagePublisher();

    const generateSettlement = new GenerateSettlementService(
      reservations,
      new InMemoryLodgingQuotes([storedQuote(QUOTE_A, ROOM_ID)]),
      settlements,
    );
    const generateInvoice = new GenerateFinalInvoiceService(
      generateSettlement,
      new GetCurrentVatRateService(vatRates),
      invoices,
    );
    service = new RegisterCheckoutService(
      eventLogs,
      publisher,
      new CheckoutEventProcessorService(generateSettlement, generateInvoice),
    );
  });

  function deliver(envelope: Record<string, any> = validEnvelope(), retryCount?: number) {
    return service.register({
      body: toBody(envelope),
      headers: retryCount === undefined ? {} : { 'x-retry-count': retryCount },
    });
  }

  it('check-out válido: ack, PROCESSED, una liquidación y la factura número 1 (HU1)', async () => {
    await expect(deliver()).resolves.toBe('ACK');

    expect(eventLogs.byEventId(EVENT_ID)).toMatchObject({ status: 'PROCESSED', resultNote: null });
    expect(settlements.byStayId.get(STAY_ID)).toMatchObject({ status: 'FINAL', channel: 'DIRECT' });
    expect(invoices.byStayId.get(STAY_ID)).toMatchObject({
      invoiceNumber: 1,
      lodgingAmount: '750000.00',
      vatAmount: '142500.00',
      totalAmount: '892500.00',
    });
    expect(publisher.published).toEqual([]);
  });

  it('reserva OTA: la factura copia la comisión como referencia y el total es hospedaje + IVA', async () => {
    reservations.respondWith(otaReservation({ quoteIds: [QUOTE_A] }));

    await deliver();

    expect(invoices.byStayId.get(STAY_ID)).toMatchObject({
      channel: 'OTA',
      otaCommissionAmount: '112500.00',
      netIncome: '637500.00',
      totalAmount: '892500.00',
    });
  });

  it('sin datos tributarios: PROCESSED con la nota del contrato, liquidación sin factura (regla 5)', async () => {
    const envelope = validEnvelope();
    envelope.payload.billingCustomer = { name: 'Comercializadora Andina S.A.S.' };

    await expect(deliver(envelope)).resolves.toBe('ACK');

    expect(eventLogs.byEventId(EVENT_ID)).toMatchObject({
      status: 'PROCESSED',
      resultNote: 'Factura no emitida: datos tributarios ausentes o incompletos',
    });
    expect(settlements.byStayId.has(STAY_ID)).toBe(true);
    expect(invoices.byStayId.has(STAY_ID)).toBe(false);
    expect(invoices.lastNumber).toBe(0);
  });

  it('la auditoría nunca guarda nombre ni documento fiscal, solo has_billing_customer (T017)', async () => {
    await deliver();

    const payload = JSON.stringify(eventLogs.byEventId(EVENT_ID)?.payload);
    expect(payload).not.toContain('Comercializadora');
    expect(payload).not.toContain('900123456-7');
    expect(eventLogs.byEventId(EVENT_ID)?.payload).toMatchObject({ has_billing_customer: true });
  });

  it('reentrega del mismo mensaje: ack sin volver a consultar Módulo 2 ni emitir otra factura', async () => {
    await deliver();
    const requests = reservations.calls.length;

    await expect(deliver()).resolves.toBe('ACK');

    expect(reservations.calls).toHaveLength(requests);
    expect(invoices.lastNumber).toBe(1);
    expect(eventLogs.logs).toHaveLength(1);
  });

  it('otro evento con los mismos datos de la estancia: reutiliza liquidación y factura (HU3)', async () => {
    await deliver();

    await expect(deliver({ ...validEnvelope(), eventId: OTHER_EVENT_ID })).resolves.toBe('ACK');

    expect(eventLogs.byEventId(OTHER_EVENT_ID)?.status).toBe('PROCESSED');
    expect(settlements.inserts).toBe(1);
    expect(invoices.lastNumber).toBe(1);
  });

  it('otro evento con datos contradictorios: SETTLEMENT_ALREADY_EXISTS a la DLQ, sin tocar lo emitido', async () => {
    await deliver();
    const contradictory: Record<string, any> = { ...validEnvelope(), eventId: OTHER_EVENT_ID };
    contradictory.payload.checkOutDate = '2026-10-09';

    await expect(deliver(contradictory)).resolves.toBe('ACK');

    expect(eventLogs.byEventId(OTHER_EVENT_ID)).toMatchObject({
      status: 'DEAD_LETTER',
      errorCode: 'SETTLEMENT_ALREADY_EXISTS',
    });
    expect(publisher.published.map((message) => message.queue)).toEqual(['dlq']);
    expect(invoices.lastNumber).toBe(1);
  });

  it('Módulo 2 caído: va a la cola de reintento y la reentrega (x-retry-count 1) termina la factura', async () => {
    reservations.respondWith(new Module2UnavailableError('RES-000123'));

    await expect(deliver()).resolves.toBe('ACK');
    expect(publisher.published).toEqual([
      expect.objectContaining({ queue: 'retry', retryCount: 1 }),
    ]);
    expect(eventLogs.byEventId(EVENT_ID)?.status).toBe('PENDING');
    expect(settlements.byStayId.has(STAY_ID)).toBe(false);

    reservations.respondWith(directReservation({ quoteIds: [QUOTE_A] }));
    await expect(deliver(validEnvelope(), 1)).resolves.toBe('ACK');

    expect(eventLogs.byEventId(EVENT_ID)?.status).toBe('PROCESSED');
    expect(invoices.byStayId.get(STAY_ID)?.invoiceNumber).toBe(1);
  });

  it('agotados los 5 reintentos: DLQ con MODULE2_UNAVAILABLE (T019)', async () => {
    reservations.respondWith(new Module2UnavailableError('RES-000123'));

    await deliver(validEnvelope(), 5);

    expect(publisher.published.map((message) => message.queue)).toEqual(['dlq']);
    expect(eventLogs.byEventId(EVENT_ID)).toMatchObject({
      status: 'DEAD_LETTER',
      errorCode: 'MODULE2_UNAVAILABLE',
    });
  });

  it('IVA nunca configurado: DLQ sin reintentos; la liquidación queda guardada y sin factura', async () => {
    vatRates.current = null;

    await expect(deliver()).resolves.toBe('ACK');

    expect(publisher.published.map((message) => message.queue)).toEqual(['dlq']);
    expect(eventLogs.byEventId(EVENT_ID)).toMatchObject({
      status: 'DEAD_LETTER',
      errorCode: 'VAT_RATE_NOT_CONFIGURED',
    });
    expect(settlements.byStayId.has(STAY_ID)).toBe(true);
    expect(invoices.lastNumber).toBe(0);
  });

  it('fallo transitorio al leer el IVA: reintento, no DLQ', async () => {
    vatRates.failWith = new Error('conexión perdida');

    await deliver();

    expect(publisher.published).toEqual([
      expect.objectContaining({ queue: 'retry', retryCount: 1 }),
    ]);
    expect(invoices.lastNumber).toBe(0);
  });

  it('evento inválido: REJECTED a la DLQ sin llamar a 007 ni a 006', async () => {
    const envelope = validEnvelope();
    delete envelope.payload.stayId;

    await expect(deliver(envelope)).resolves.toBe('ACK');

    expect(eventLogs.byEventId(EVENT_ID)).toMatchObject({
      status: 'REJECTED',
      errorCode: 'INVALID_CHECKOUT_EVENT',
    });
    expect(reservations.calls).toEqual([]);
    expect(settlements.byStayId.size).toBe(0);
  });
});
