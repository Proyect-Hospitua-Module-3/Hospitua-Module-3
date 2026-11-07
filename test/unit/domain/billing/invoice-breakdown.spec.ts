// Feature 006 · Generar factura final (T015, T023, T024)
import { VatRateValue } from '../../../../src/domain/model/billing/vat-rate-value.vo';
import {
  InvoiceAmounts,
  InvoiceBreakdown,
} from '../../../../src/domain/model/billing/invoice-breakdown';

const VAT_19 = VatRateValue.of('19.00');

function settlementAmounts(overrides: Partial<InvoiceAmounts> = {}) {
  return {
    currency: 'COP',
    lodgingAmount: '750000.00',
    otaCommissionAmount: '0.00',
    netIncome: '750000.00',
    ...overrides,
  };
}

describe('InvoiceBreakdown', () => {
  it('canal directo: comisión 0.00, IVA sobre el hospedaje y total = hospedaje + IVA (HU2 esc. 1)', () => {
    expect(InvoiceBreakdown.calculate(settlementAmounts(), VAT_19)).toEqual({
      currency: 'COP',
      lodgingAmount: '750000.00',
      otaCommissionAmount: '0.00',
      netIncome: '750000.00',
      vatRateApplied: '19.00',
      vatAmount: '142500.00',
      totalAmount: '892500.00',
    });
  });

  it('canal OTA: la comisión y el neto son referencia; el total no los suma ni los resta (HU2 esc. 2)', () => {
    const amounts = InvoiceBreakdown.calculate(
      settlementAmounts({ otaCommissionAmount: '112500.00', netIncome: '637500.00' }),
      VAT_19,
    );

    expect(amounts.otaCommissionAmount).toBe('112500.00');
    expect(amounts.netIncome).toBe('637500.00');
    expect(amounts.vatAmount).toBe('142500.00');
    expect(amounts.totalAmount).toBe('892500.00');
  });

  it.each([
    // 100.05 × 19 % = 19.0095 → 19.01
    ['100.05', '19.00', '19.01', '119.06'],
    // 0.50 × 5 % = 0.025 → 0.03 (half-up, no al par)
    ['0.50', '5.00', '0.03', '0.53'],
    // 1234.56 × 19.75 % = 243.8256 → 243.83
    ['1234.56', '19.75', '243.83', '1478.39'],
    // IVA 0 % → total = hospedaje
    ['750000.00', '0.00', '0.00', '750000.00'],
    // Hospedaje cero (ajuste de temporada de -100 %)
    ['0.00', '19.00', '0.00', '0.00'],
  ])(
    'hospedaje %s con IVA %s → IVA %s y total %s (half-up a 2 decimales)',
    (lodging, rate, vat, total) => {
      const amounts = InvoiceBreakdown.calculate(
        settlementAmounts({ lodgingAmount: lodging, netIncome: lodging }),
        VatRateValue.of(rate),
      );

      expect(amounts.vatAmount).toBe(vat);
      expect(amounts.totalAmount).toBe(total);
    },
  );

  it('es determinista: el mismo insumo da siempre el mismo desglose (NFR-001)', () => {
    const first = InvoiceBreakdown.calculate(settlementAmounts(), VAT_19);
    const second = InvoiceBreakdown.calculate(settlementAmounts(), VAT_19);

    expect(second).toEqual(first);
    expect(Object.isFrozen(first)).toBe(true);
  });

  describe('verified (integridad)', () => {
    const valid: InvoiceAmounts = {
      ...settlementAmounts(),
      vatRateApplied: '19.00',
      vatAmount: '142500.00',
      totalAmount: '892500.00',
    };

    it('acepta un desglose que cuadra', () => {
      expect(InvoiceBreakdown.verified(valid)).toEqual(valid);
    });

    it.each<[string, Partial<InvoiceAmounts>]>([
      ['total ≠ hospedaje + IVA', { totalAmount: '892500.01' }],
      [
        'total que suma la comisión',
        { otaCommissionAmount: '112500.00', netIncome: '637500.00', totalAmount: '1005000.00' },
      ],
      ['neto ≠ hospedaje − comisión', { netIncome: '700000.00' }],
      ['importe negativo', { otaCommissionAmount: '-1.00', netIncome: '750001.00' }],
      ['tasa fuera de 0–100', { vatRateApplied: '101.00' }],
      ['moneda distinta de COP', { currency: 'USD' }],
    ])('rechaza %s', (_case, overrides) => {
      expect(() => InvoiceBreakdown.verified({ ...valid, ...overrides })).toThrow();
    });
  });
});
