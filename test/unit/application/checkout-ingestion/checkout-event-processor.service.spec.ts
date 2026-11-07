// Feature 010 · Registrar Check-out (T010, T015)
import {
  CheckoutEventProcessorService,
  INVOICE_NOT_ISSUED_NOTE,
} from '../../../../src/application/services/checkout-ingestion/checkout-event-processor.service';
import { Module2UnavailableError } from '../../../../src/domain/errors/settlement/module2-unavailable.error';
import { VatRateNotConfiguredError } from '../../../../src/domain/errors/billing/vat-rate-not-configured.error';
import { Invoice } from '../../../../src/domain/model/billing/invoice';
import {
  CheckoutEvent,
  recognizeCheckoutEnvelope,
} from '../../../../src/domain/model/checkout-ingestion/checkout-event';
import { Settlement } from '../../../../src/domain/model/settlement/settlement';
import {
  GenerateFinalInvoiceCommand,
  GenerateFinalInvoiceResult,
  GenerateFinalInvoiceUseCase,
} from '../../../../src/domain/ports/in/billing/generate-final-invoice.use-case';
import {
  GenerateSettlementCommand,
  GenerateSettlementUseCase,
} from '../../../../src/domain/ports/in/settlement/generate-settlement.use-case';
import { validEnvelope } from '../../../support/checkout-ingestion/checkout-event-fixtures';

function eventOf(envelope: Record<string, any> = validEnvelope()): CheckoutEvent {
  const recognition = recognizeCheckoutEnvelope(envelope);
  if (!recognition.recognized) throw new Error(recognition.reason);
  return recognition.envelope.toCheckoutEvent();
}

class FakeSettlements implements GenerateSettlementUseCase {
  constructor(
    readonly calls: string[],
    private readonly failure?: Error,
  ) {}
  readonly commands: GenerateSettlementCommand[] = [];
  async generate(command: GenerateSettlementCommand): Promise<Settlement> {
    this.calls.push('007');
    this.commands.push(command);
    if (this.failure) throw this.failure;
    return {} as Settlement;
  }
}

class FakeInvoices implements GenerateFinalInvoiceUseCase {
  constructor(
    readonly calls: string[],
    private readonly result: GenerateFinalInvoiceResult | Error = {
      status: 'ISSUED',
      invoice: {} as Invoice,
    },
  ) {}
  readonly commands: GenerateFinalInvoiceCommand[] = [];
  async generate(command: GenerateFinalInvoiceCommand): Promise<GenerateFinalInvoiceResult> {
    this.calls.push('006');
    this.commands.push(command);
    if (this.result instanceof Error) throw this.result;
    return this.result;
  }
}

describe('CheckoutEventProcessorService', () => {
  let calls: string[];

  beforeEach(() => {
    calls = [];
  });

  it('genera la liquidación (007) y después la factura (006)', async () => {
    const processor = new CheckoutEventProcessorService(
      new FakeSettlements(calls),
      new FakeInvoices(calls),
    );

    await expect(processor.process(eventOf())).resolves.toEqual({ resultNote: null });
    expect(calls).toEqual(['007', '006']);
  });

  it('007 recibe los datos del check-out sin billingCustomer; 006 los recibe tal como llegaron', async () => {
    const settlements = new FakeSettlements(calls);
    const invoices = new FakeInvoices(calls);
    const event = eventOf();

    await new CheckoutEventProcessorService(settlements, invoices).process(event);

    const checkout = {
      eventId: event.eventId,
      stayId: event.stayId,
      reservationRef: 'RES-000123',
      roomId: event.roomId,
      categoryRoom: 'DOBLE',
      checkInDate: '2026-10-05',
      checkOutDate: '2026-10-08',
    };
    expect(settlements.commands).toEqual([checkout]);
    expect(settlements.commands[0]).not.toHaveProperty('billingCustomer');
    expect(invoices.commands).toEqual([
      {
        ...checkout,
        billingCustomer: { name: 'Comercializadora Andina S.A.S.', taxId: '900123456-7' },
      },
    ]);
  });

  it('sin billingCustomer en el evento, 006 recibe null', async () => {
    const envelope = validEnvelope();
    delete envelope.payload.billingCustomer;
    const invoices = new FakeInvoices(calls, {
      status: 'NOT_ISSUED',
      reason: 'BILLING_CUSTOMER_DATA_MISSING',
    });

    await new CheckoutEventProcessorService(new FakeSettlements(calls), invoices).process(
      eventOf(envelope),
    );

    expect(invoices.commands[0].billingCustomer).toBeNull();
  });

  it('NOT_ISSUED de 006 es un resultado normal con la nota del contrato (regla 5)', async () => {
    const processor = new CheckoutEventProcessorService(
      new FakeSettlements(calls),
      new FakeInvoices(calls, { status: 'NOT_ISSUED', reason: 'BILLING_CUSTOMER_DATA_MISSING' }),
    );

    await expect(processor.process(eventOf())).resolves.toEqual({
      resultNote: 'Factura no emitida: datos tributarios ausentes o incompletos',
    });
    expect(INVOICE_NOT_ISSUED_NOTE).toBe(
      'Factura no emitida: datos tributarios ausentes o incompletos',
    );
  });

  it('si 007 falla, propaga su error y no invoca a 006', async () => {
    const error = new Module2UnavailableError('RES-000123');
    const processor = new CheckoutEventProcessorService(
      new FakeSettlements(calls, error),
      new FakeInvoices(calls),
    );

    await expect(processor.process(eventOf())).rejects.toBe(error);
    expect(calls).toEqual(['007']);
  });

  it('si 006 falla, propaga su error tal cual', async () => {
    const error = new VatRateNotConfiguredError();
    const processor = new CheckoutEventProcessorService(
      new FakeSettlements(calls),
      new FakeInvoices(calls, error),
    );

    await expect(processor.process(eventOf())).rejects.toBe(error);
  });
});
