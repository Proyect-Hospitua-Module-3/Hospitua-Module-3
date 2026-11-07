// Feature 006 · Generar factura final (T012)
import { BillingCustomer } from '../../../../src/domain/model/billing/billing-customer';
import { Invoice, InvoiceDraft } from '../../../../src/domain/model/billing/invoice';
import { InvoiceBreakdown } from '../../../../src/domain/model/billing/invoice-breakdown';
import { VatRateValue } from '../../../../src/domain/model/billing/vat-rate-value.vo';
import { Settlement } from '../../../../src/domain/model/settlement/settlement';
import {
  CUSTOMER,
  directSettlement,
  EVENT_ID,
  INVOICE_ID,
  ISSUED_AT,
  otaSettlement,
} from '../../../support/billing/fake-invoice-ports';

function draftFor(settlement: Settlement): InvoiceDraft {
  return Invoice.prepare({
    invoiceId: INVOICE_ID,
    sourceEventId: EVENT_ID,
    settlement,
    customer: BillingCustomer.restore(CUSTOMER.name, CUSTOMER.taxId),
    amounts: InvoiceBreakdown.calculate(settlement, VatRateValue.of('19.00')),
  });
}

describe('Invoice', () => {
  it('prepare copia la liquidación de origen, el cliente y el desglose (FR-010, FR-012)', () => {
    const draft = draftFor(otaSettlement());

    expect(draft).toEqual(
      expect.objectContaining({
        invoiceId: INVOICE_ID,
        settlementId: otaSettlement().settlementId,
        stayId: otaSettlement().stayId,
        sourceEventId: EVENT_ID,
        reservationRef: 'RES-000123',
        channel: 'OTA',
        otaId: 'booking',
        lodgingAmount: '750000.00',
        otaCommissionAmount: '112500.00',
        netIncome: '637500.00',
        vatRateApplied: '19.00',
        vatAmount: '142500.00',
        totalAmount: '892500.00',
      }),
    );
    expect(draft.customer.name).toBe(CUSTOMER.name);
    expect(Object.isFrozen(draft)).toBe(true);
  });

  it('restore: factura ISSUED, inmutable y congelada, sin métodos de modificación (FR-006)', () => {
    const invoice = Invoice.restore({
      ...draftFor(directSettlement()),
      invoiceNumber: 1042,
      issuedAt: ISSUED_AT,
    });

    expect(invoice.status).toBe('ISSUED');
    expect(invoice.immutable).toBe(true);
    expect(invoice.invoiceNumber).toBe(1042);
    expect(invoice.issuedAt).toEqual(ISSUED_AT);
    expect(invoice.issuedAt).not.toBe(ISSUED_AT);
    expect(Object.isFrozen(invoice)).toBe(true);
    const methods = Object.getOwnPropertyNames(Invoice.prototype).filter(
      (name) => name !== 'constructor',
    );
    expect(methods).toEqual([]);
  });

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    'rechaza el número de factura %p',
    (invoiceNumber) => {
      expect(() =>
        Invoice.restore({ ...draftFor(directSettlement()), invoiceNumber, issuedAt: ISSUED_AT }),
      ).toThrow();
    },
  );

  it('rechaza un total que no es hospedaje + IVA', () => {
    expect(() =>
      Invoice.restore({
        ...draftFor(directSettlement()),
        totalAmount: '750000.00',
        invoiceNumber: 1,
        issuedAt: ISSUED_AT,
      }),
    ).toThrow();
  });

  it('rechaza canal OTA sin otaId y canal directo con comisión', () => {
    const ota = draftFor(otaSettlement());
    const direct = draftFor(directSettlement());

    expect(() =>
      Invoice.restore({ ...ota, otaId: null, invoiceNumber: 1, issuedAt: ISSUED_AT }),
    ).toThrow();
    expect(() =>
      Invoice.restore({
        ...direct,
        otaCommissionAmount: '112500.00',
        netIncome: '637500.00',
        invoiceNumber: 1,
        issuedAt: ISSUED_AT,
      }),
    ).toThrow();
  });
});
