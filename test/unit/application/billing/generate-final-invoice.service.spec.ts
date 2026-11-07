// Feature 006 · Generar factura final (T013, T014, T015, T016, T023)
import { GenerateFinalInvoiceService } from '../../../../src/application/services/billing/generate-final-invoice.service';
import { FinalSettlementNotFoundError } from '../../../../src/domain/errors/billing/final-settlement-not-found.error';
import { InvoicePersistenceUnavailableError } from '../../../../src/domain/errors/billing/invoice-persistence-unavailable.error';
import { VatRateNotConfiguredError } from '../../../../src/domain/errors/billing/vat-rate-not-configured.error';
import { VatRateUnavailableError } from '../../../../src/domain/errors/billing/vat-rate-unavailable.error';
import { InvalidCheckoutDataError } from '../../../../src/domain/errors/settlement/invalid-checkout-data.error';
import { Module2UnavailableError } from '../../../../src/domain/errors/settlement/module2-unavailable.error';
import { SettlementAlreadyExistsError } from '../../../../src/domain/errors/settlement/settlement-already-exists.error';
import { BillingCustomer } from '../../../../src/domain/model/billing/billing-customer';
import { Invoice } from '../../../../src/domain/model/billing/invoice';
import { InvoiceBreakdown } from '../../../../src/domain/model/billing/invoice-breakdown';
import { VatRateValue } from '../../../../src/domain/model/billing/vat-rate-value.vo';
import { Settlement } from '../../../../src/domain/model/settlement/settlement';
import {
  CUSTOMER,
  directSettlement,
  EVENT_ID,
  FakeGenerateSettlement,
  FakeVatRates,
  InMemoryInvoiceIssuance,
  INVOICE_ID,
  invoiceCommand,
  otaSettlement,
  RESERVATION_REF,
  ROOM_ID,
  SETTLEMENT_ID,
  STAY_ID,
  vatRate,
} from '../../../support/billing/fake-invoice-ports';

const OTHER_STAY = 'd4b0f2c3-6a5e-4f7b-9c8d-2e3f4a5b6c7d';

describe('GenerateFinalInvoiceService', () => {
  let settlements: FakeGenerateSettlement;
  let vatRates: FakeVatRates;
  let invoices: InMemoryInvoiceIssuance;
  let service: GenerateFinalInvoiceService;

  beforeEach(() => {
    settlements = new FakeGenerateSettlement();
    vatRates = new FakeVatRates();
    invoices = new InMemoryInvoiceIssuance();
    service = new GenerateFinalInvoiceService(settlements, vatRates, invoices, () => INVOICE_ID);
  });

  async function issuedInvoice(command = invoiceCommand()): Promise<Invoice> {
    const result = await service.generate(command);
    if (result.status !== 'ISSUED') throw new Error(`se esperaba ISSUED, llegó ${result.status}`);
    return result.invoice;
  }

  describe('HU1 — emitir la factura al registrar el check-out', () => {
    it('canal directo: número 1, IVA sobre el hospedaje, total = hospedaje + IVA, inmutable (esc. 1)', async () => {
      const invoice = await issuedInvoice();

      expect(invoice).toEqual(
        expect.objectContaining({
          invoiceId: INVOICE_ID,
          invoiceNumber: 1,
          status: 'ISSUED',
          immutable: true,
          settlementId: SETTLEMENT_ID,
          stayId: STAY_ID,
          sourceEventId: EVENT_ID,
          reservationRef: RESERVATION_REF,
          channel: 'DIRECT',
          otaId: null,
          currency: 'COP',
          lodgingAmount: '750000.00',
          otaCommissionAmount: '0.00',
          netIncome: '750000.00',
          vatRateApplied: '19.00',
          vatAmount: '142500.00',
          totalAmount: '892500.00',
        }),
      );
      expect(invoice.customer).toEqual(expect.objectContaining(CUSTOMER));
    });

    it('incluye a 007 con los datos del check-out, sin billingCustomer (FR-001)', async () => {
      await service.generate(invoiceCommand());

      expect(settlements.calls).toEqual([
        {
          eventId: EVENT_ID,
          stayId: STAY_ID,
          reservationRef: RESERVATION_REF,
          roomId: ROOM_ID,
          categoryRoom: 'DOBLE',
          checkInDate: '2026-12-20',
          checkOutDate: '2026-12-23',
        },
      ]);
    });

    it('normaliza los UUID a minúsculas antes de llamar a 007 y buscar la factura', async () => {
      settlements.respondWith(directSettlement());

      const invoice = await issuedInvoice(
        invoiceCommand({ stayId: STAY_ID.toUpperCase(), roomId: ROOM_ID.toUpperCase() }),
      );

      expect(settlements.calls[0]).toEqual(
        expect.objectContaining({ stayId: STAY_ID, roomId: ROOM_ID }),
      );
      expect(invoice.stayId).toBe(STAY_ID);
    });

    it('canal OTA: el total es hospedaje bruto + IVA; la comisión y el neto son solo referencia (esc. 2)', async () => {
      settlements.respondWith(otaSettlement());

      const invoice = await issuedInvoice();

      expect(invoice.channel).toBe('OTA');
      expect(invoice.otaId).toBe('booking');
      expect(invoice.otaCommissionAmount).toBe('112500.00');
      expect(invoice.netIncome).toBe('637500.00');
      expect(invoice.vatAmount).toBe('142500.00');
      expect(invoice.totalAmount).toBe('892500.00');
    });

    it('estancias distintas reciben números consecutivos', async () => {
      const first = await issuedInvoice();
      settlements.respondWith(
        directSettlement({
          stayId: OTHER_STAY,
          settlementId: '5f3c9d2e-0b8a-4a4f-87e6-1d2b3c4e5f6a',
        }),
      );
      const second = await issuedInvoice(invoiceCommand({ stayId: OTHER_STAY }));

      expect([first.invoiceNumber, second.invoiceNumber]).toEqual([1, 2]);
    });
  });

  describe('Idempotencia (esc. 3, FR-007, T016)', () => {
    it('una estancia ya facturada devuelve la misma factura sin llamar a 007 ni al IVA', async () => {
      const original = await issuedInvoice();
      settlements.calls.length = 0;
      vatRates.calls = 0;

      const again = await issuedInvoice();

      expect(again).toBe(original);
      expect(settlements.calls).toEqual([]);
      expect(vatRates.calls).toBe(0);
      expect(invoices.lastNumber).toBe(1);
    });

    it('si el IVA cambió después de emitir, el reenvío conserva el número y los valores originales (BR-005)', async () => {
      const original = await issuedInvoice();
      vatRates.respondWith(vatRate('5.00'));

      const again = await issuedInvoice();

      expect(again.invoiceNumber).toBe(original.invoiceNumber);
      expect(again.vatRateApplied).toBe('19.00');
      expect(again.totalAmount).toBe('892500.00');
    });

    it('si otra entrega emitió mientras tanto, devuelve la ganadora sin consumir otro número', async () => {
      const winner = Invoice.prepare({
        invoiceId: '8e2d3a1f-5c9b-4d62-8b4f-3a7c2e0d9f12',
        sourceEventId: EVENT_ID,
        settlement: directSettlement(),
        customer: BillingCustomer.restore(CUSTOMER.name, CUSTOMER.taxId),
        amounts: InvoiceBreakdown.calculate(directSettlement(), VatRateValue.of('19.00')),
      });
      invoices.issueConcurrentlyBeforeNextIssue(winner);

      const invoice = await issuedInvoice();

      expect(invoice.invoiceId).toBe(winner.invoiceId);
      expect(invoices.lastNumber).toBe(1);
    });
  });

  describe('Datos tributarios (FR-008, FR-009, T014)', () => {
    it.each([
      ['ausentes', undefined],
      ['null', null],
      ['sin documento', { name: CUSTOMER.name }],
      ['sin nombre', { taxId: CUSTOMER.taxId }],
      ['en blanco', { name: ' ', taxId: ' ' }],
    ])(
      '%s → NOT_ISSUED con BILLING_CUSTOMER_DATA_MISSING, sin leer IVA ni asignar número',
      async (_case, billingCustomer) => {
        const result = await service.generate(invoiceCommand({ billingCustomer }));

        expect(result).toEqual({ status: 'NOT_ISSUED', reason: 'BILLING_CUSTOMER_DATA_MISSING' });
        // La liquidación sí se genera (BR-004).
        expect(settlements.calls).toHaveLength(1);
        expect(vatRates.calls).toBe(0);
        expect(invoices.drafts).toEqual([]);
        expect(invoices.lastNumber).toBe(0);
      },
    );
  });

  describe('Errores: nada que falle antes de emitir consume número', () => {
    it('comando inválido → INVALID_CHECKOUT_EVENT antes de cualquier IO', async () => {
      await expect(
        service.generate(invoiceCommand({ stayId: 'no-es-uuid' })),
      ).rejects.toBeInstanceOf(InvalidCheckoutDataError);
      expect(settlements.calls).toEqual([]);
      expect(invoices.drafts).toEqual([]);
    });

    it.each([
      ['SETTLEMENT_ALREADY_EXISTS', new SettlementAlreadyExistsError(STAY_ID, ['roomId'])],
      ['MODULE2_UNAVAILABLE', new Module2UnavailableError(RESERVATION_REF)],
    ])('propaga %s de 007 sin crear factura', async (_code, error) => {
      settlements.respondWith(error);

      await expect(service.generate(invoiceCommand())).rejects.toBe(error);
      expect(vatRates.calls).toBe(0);
      expect(invoices.drafts).toEqual([]);
    });

    it.each<[string, Settlement]>([
      ['no es Final', { ...directSettlement(), status: 'INFORMATIVE' } as unknown as Settlement],
      ['es de otra estancia', directSettlement({ stayId: OTHER_STAY })],
    ])(
      'si 007 devuelve una liquidación que %s → FINAL_SETTLEMENT_NOT_FOUND',
      async (_case, settlement) => {
        settlements.respondWith(settlement);

        await expect(service.generate(invoiceCommand())).rejects.toBeInstanceOf(
          FinalSettlementNotFoundError,
        );
        expect(vatRates.calls).toBe(0);
        expect(invoices.drafts).toEqual([]);
      },
    );

    it.each([
      ['VAT_RATE_NOT_CONFIGURED (no reintentable)', new VatRateNotConfiguredError()],
      ['VAT_RATE_UNAVAILABLE (reintentable)', new VatRateUnavailableError()],
    ])('propaga %s sin asignar número', async (_case, error) => {
      vatRates.respondWith(error);

      await expect(service.generate(invoiceCommand())).rejects.toBe(error);
      expect(invoices.drafts).toEqual([]);
      expect(invoices.lastNumber).toBe(0);
    });

    it('propaga DATABASE_UNAVAILABLE de la emisión; el reintento emite con el mismo número', async () => {
      invoices.failNextIssueWith(new InvoicePersistenceUnavailableError());

      await expect(service.generate(invoiceCommand())).rejects.toBeInstanceOf(
        InvoicePersistenceUnavailableError,
      );
      expect(invoices.lastNumber).toBe(0);

      expect((await issuedInvoice()).invoiceNumber).toBe(1);
    });
  });
});
