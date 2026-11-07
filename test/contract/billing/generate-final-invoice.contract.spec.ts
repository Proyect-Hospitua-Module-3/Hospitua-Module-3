// Feature 006 · Generar factura final (T018, T026)
// Contrato UC-generate-final-invoice.md: forma del resultado que consumen 010, 002 y 008.
import { GenerateFinalInvoiceService } from '../../../src/application/services/billing/generate-final-invoice.service';
import { GenerateFinalInvoiceUseCase } from '../../../src/domain/ports/in/billing/generate-final-invoice.use-case';
import {
  FakeGenerateSettlement,
  FakeVatRates,
  InMemoryInvoiceIssuance,
  INVOICE_ID,
  invoiceCommand,
  otaSettlement,
} from '../../support/billing/fake-invoice-ports';

const DECIMAL_STRING = /^\d+\.\d{2}$/;

describe('Contrato GenerateFinalInvoiceUseCase (006 → 010, 002, 008)', () => {
  let port: GenerateFinalInvoiceUseCase;

  beforeEach(() => {
    port = new GenerateFinalInvoiceService(
      new FakeGenerateSettlement(otaSettlement()),
      new FakeVatRates(),
      new InMemoryInvoiceIssuance(),
      () => INVOICE_ID,
    );
  });

  it('ISSUED: el JSON de la factura tiene exactamente los campos del contrato (ejemplo OTA)', async () => {
    const result = await port.generate(invoiceCommand());

    expect(JSON.parse(JSON.stringify(result))).toEqual({
      status: 'ISSUED',
      invoice: {
        invoiceId: INVOICE_ID,
        invoiceNumber: 1,
        status: 'ISSUED',
        immutable: true,
        issuedAt: '2026-12-23T16:05:12.000Z',
        settlementId: '4e2b8c1d-9a7f-4f3e-b6d5-0c1a2b3d4e5f',
        stayId: 'c3a9e1b2-5f4d-4e6a-8b7c-1d2e3f4a5b6c',
        sourceEventId: '9b1f6d3e-2c4a-4f7b-8e5d-3a1c0b9d8e72',
        reservationRef: 'RES-000123',
        channel: 'OTA',
        otaId: 'booking',
        customer: { name: 'Comercializadora Andina S.A.S.', taxId: '900123456-7' },
        currency: 'COP',
        lodgingAmount: '750000.00',
        otaCommissionAmount: '112500.00',
        netIncome: '637500.00',
        vatRateApplied: '19.00',
        vatAmount: '142500.00',
        totalAmount: '892500.00',
      },
    });
  });

  it('los importes y la tasa son texto decimal, nunca number', async () => {
    const result = await port.generate(invoiceCommand());
    if (result.status !== 'ISSUED') throw new Error('se esperaba ISSUED');

    for (const field of [
      'lodgingAmount',
      'otaCommissionAmount',
      'netIncome',
      'vatRateApplied',
      'vatAmount',
      'totalAmount',
    ] as const) {
      expect(typeof result.invoice[field]).toBe('string');
      expect(result.invoice[field]).toMatch(DECIMAL_STRING);
    }
    expect(Number.isInteger(result.invoice.invoiceNumber)).toBe(true);
  });

  it('NOT_ISSUED: solo status y reason, sin factura ni número', async () => {
    const result = await port.generate(invoiceCommand({ billingCustomer: undefined }));

    expect(JSON.parse(JSON.stringify(result))).toEqual({
      status: 'NOT_ISSUED',
      reason: 'BILLING_CUSTOMER_DATA_MISSING',
    });
  });

  it('el comando no acepta importes, IVA, canal ni número: se ignoran si llegan', async () => {
    const tampered = {
      ...invoiceCommand(),
      lodgingAmount: '1.00',
      vatRateApplied: '0.00',
      channel: 'DIRECT',
      invoiceNumber: 99,
    };

    const result = await port.generate(tampered);
    if (result.status !== 'ISSUED') throw new Error('se esperaba ISSUED');

    expect(result.invoice.lodgingAmount).toBe('750000.00');
    expect(result.invoice.vatRateApplied).toBe('19.00');
    expect(result.invoice.channel).toBe('OTA');
    expect(result.invoice.invoiceNumber).toBe(1);
  });

  it('el resultado no contiene datos migratorios (FR-013)', async () => {
    const json = JSON.stringify(await port.generate(invoiceCommand()));

    for (const field of ['nationality', 'documentType', 'visaType', 'passport', 'migration']) {
      expect(json).not.toContain(field);
    }
  });
});
