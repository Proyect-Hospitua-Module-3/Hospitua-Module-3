// Feature 006 · Generar factura final
// Dobles de prueba de los puertos de GenerateFinalInvoiceService y datos de ejemplo del
// contrato UC-generate-final-invoice (hospedaje 750.000; OTA con 15 % = 112.500; IVA 19 %).
import { VatRate } from '../../../src/domain/model/billing/vat-rate';
import { VatRateValue } from '../../../src/domain/model/billing/vat-rate-value.vo';
import { Invoice, InvoiceDraft } from '../../../src/domain/model/billing/invoice';
import { Settlement, StoredSettlement } from '../../../src/domain/model/settlement/settlement';
import { GenerateFinalInvoiceCommand } from '../../../src/domain/ports/in/billing/generate-final-invoice.use-case';
import { GetCurrentVatRateUseCase } from '../../../src/domain/ports/in/billing/get-current-vat-rate.use-case';
import {
  GenerateSettlementCommand,
  GenerateSettlementUseCase,
} from '../../../src/domain/ports/in/settlement/generate-settlement.use-case';
import { InvoiceIssuanceRepositoryPort } from '../../../src/domain/ports/out/billing/invoice-issuance.repository.port';

export const EVENT_ID = '9b1f6d3e-2c4a-4f7b-8e5d-3a1c0b9d8e72';
export const STAY_ID = 'c3a9e1b2-5f4d-4e6a-8b7c-1d2e3f4a5b6c';
export const SETTLEMENT_ID = '4e2b8c1d-9a7f-4f3e-b6d5-0c1a2b3d4e5f';
export const INVOICE_ID = '7d1c2f0e-4b8a-4c51-9a3e-2f6b1d9c8e01';
export const RESERVATION_REF = 'RES-000123';
export const ROOM_ID = '5f0e8a47-1b2c-4d3e-9f6a-7b8c9d0e1f23';
export const QUOTE_ID = 'a1f2c3d4-e5b6-4789-8a9b-0c1d2e3f4a5b';
export const ISSUED_AT = new Date('2026-12-23T16:05:12.000Z');
export const CUSTOMER = { name: 'Comercializadora Andina S.A.S.', taxId: '900123456-7' };

export function invoiceCommand(
  overrides: Partial<GenerateFinalInvoiceCommand> = {},
): GenerateFinalInvoiceCommand {
  return {
    eventId: EVENT_ID,
    stayId: STAY_ID,
    reservationRef: RESERVATION_REF,
    roomId: ROOM_ID,
    categoryRoom: 'DOBLE',
    checkInDate: '2026-12-20',
    checkOutDate: '2026-12-23',
    billingCustomer: { ...CUSTOMER },
    ...overrides,
  };
}

export function directSettlement(overrides: Partial<StoredSettlement> = {}): Settlement {
  return Settlement.restore({
    settlementId: SETTLEMENT_ID,
    stayId: STAY_ID,
    reservationRef: RESERVATION_REF,
    roomId: ROOM_ID,
    categoryRoom: 'DOBLE',
    checkInDate: '2026-12-20',
    checkOutDate: '2026-12-23',
    quoteId: QUOTE_ID,
    channel: 'DIRECT',
    otaId: null,
    otaConfirmationCode: null,
    otaCommissionPercentage: null,
    currency: 'COP',
    lodgingAmount: '750000.00',
    baseLodgingAmount: '700000.00',
    dynamicAdjustmentAmount: '50000.00',
    otaCommissionAmount: '0.00',
    netIncome: '750000.00',
    sourceEventId: EVENT_ID,
    generatedAt: new Date('2026-12-23T16:04:58.000Z'),
    ...overrides,
  });
}

export function otaSettlement(overrides: Partial<StoredSettlement> = {}): Settlement {
  return directSettlement({
    channel: 'OTA',
    otaId: 'booking',
    otaConfirmationCode: 'BKG-88421',
    otaCommissionPercentage: '15.00',
    otaCommissionAmount: '112500.00',
    netIncome: '637500.00',
    ...overrides,
  });
}

export function vatRate(value = '19.00'): VatRate {
  return new VatRate(VatRateValue.of(value), 'admin', new Date('2026-01-01T00:00:00.000Z'));
}

export class FakeGenerateSettlement implements GenerateSettlementUseCase {
  readonly calls: GenerateSettlementCommand[] = [];

  constructor(private result: Settlement | Error = directSettlement()) {}

  respondWith(result: Settlement | Error): void {
    this.result = result;
  }

  async generate(command: GenerateSettlementCommand): Promise<Settlement> {
    this.calls.push(command);
    if (this.result instanceof Error) throw this.result;
    return this.result;
  }
}

export class FakeVatRates implements GetCurrentVatRateUseCase {
  calls = 0;

  constructor(private result: VatRate | Error = vatRate()) {}

  respondWith(result: VatRate | Error): void {
    this.result = result;
  }

  async getCurrent(): Promise<VatRate> {
    this.calls += 1;
    if (this.result instanceof Error) throw this.result;
    return this.result;
  }
}

// Emite como la base de datos: un consecutivo que solo avanza cuando la factura se guarda.
export class InMemoryInvoiceIssuance implements InvoiceIssuanceRepositoryPort {
  readonly byStayId = new Map<string, Invoice>();
  readonly drafts: InvoiceDraft[] = [];
  lastNumber = 0;
  private failure?: Error;
  // Simula otra entrega de la misma estancia que emite justo antes de este issueIfAbsent.
  private concurrentWinner?: InvoiceDraft;

  failNextIssueWith(error: Error): void {
    this.failure = error;
  }

  issueConcurrentlyBeforeNextIssue(draft: InvoiceDraft): void {
    this.concurrentWinner = draft;
  }

  seed(draft: InvoiceDraft): Invoice {
    this.lastNumber += 1;
    const invoice = Invoice.restore({
      ...draft,
      invoiceNumber: this.lastNumber,
      issuedAt: ISSUED_AT,
    });
    this.byStayId.set(invoice.stayId, invoice);
    return invoice;
  }

  async findByStayId(stayId: string): Promise<Invoice | null> {
    return this.byStayId.get(stayId) ?? null;
  }

  async issueIfAbsent(draft: InvoiceDraft): Promise<Invoice> {
    this.drafts.push(draft);
    if (this.concurrentWinner) {
      this.seed(this.concurrentWinner);
      this.concurrentWinner = undefined;
    }
    if (this.failure) {
      const failure = this.failure;
      this.failure = undefined;
      throw failure;
    }
    return this.byStayId.get(draft.stayId) ?? this.seed(draft);
  }
}
