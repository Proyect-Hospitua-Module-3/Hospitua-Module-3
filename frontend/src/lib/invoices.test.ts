// Feature 008 · Consultas válidas y presentación exacta de importes financieros.
import { describe, expect, it } from 'vitest';
import {
  EMPTY_INVOICE_SEARCH,
  formatInvoiceMoney,
  isInvoiceDate,
  parseInvoiceSearchInput,
  parseInvoiceSummaryRange,
} from './invoices';

describe('Consultas de facturación (008)', () => {
  it('exige un criterio; tamaño y modo de coincidencia no permiten consultar todas las facturas', () => {
    const result = parseInvoiceSearchInput({
      ...EMPTY_INVOICE_SEARCH,
      pageSize: '100',
      customerMatch: 'PARTIAL',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.criteria).toMatch(/al menos un criterio/);
  });

  it('normaliza texto y solo envía coincidencia de nombre cuando se filtra por nombre', () => {
    expect(
      parseInvoiceSearchInput({ ...EMPTY_INVOICE_SEARCH, reservationRef: ' RES-008 ' }),
    ).toEqual({
      ok: true,
      query: { page: 1, pageSize: 20, reservationRef: 'RES-008' },
    });
    expect(
      parseInvoiceSearchInput({
        ...EMPTY_INVOICE_SEARCH,
        customerName: ' Andina ',
        customerMatch: 'PARTIAL',
      }),
    ).toEqual({
      ok: true,
      query: { page: 1, pageSize: 20, customerName: 'Andina', customerMatch: 'PARTIAL' },
    });
  });

  it('rechaza un UUID incorrecto aunque haya otro criterio válido', () => {
    const result = parseInvoiceSearchInput({
      ...EMPTY_INVOICE_SEARCH,
      channel: 'DIRECT',
      stayId: 'habitación-12',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.stayId).toMatch(/UUID válido/);
  });

  it('rechaza coincidencia parcial de dos letras sin limitar la coincidencia exacta', () => {
    expect(
      parseInvoiceSearchInput({
        ...EMPTY_INVOICE_SEARCH,
        customerName: 'Li',
        customerMatch: 'EXACT',
      }).ok,
    ).toBe(true);
    const result = parseInvoiceSearchInput({
      ...EMPTY_INVOICE_SEARCH,
      customerName: ' Li ',
      customerMatch: 'PARTIAL',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.customerName).toMatch(/3 caracteres/);
  });

  it('exige canal OTA para usar identificador OTA', () => {
    const result = parseInvoiceSearchInput({
      ...EMPTY_INVOICE_SEARCH,
      channel: 'DIRECT',
      otaId: 'booking',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.otaId).toBeDefined();
    expect(
      parseInvoiceSearchInput({ ...EMPTY_INVOICE_SEARCH, channel: 'OTA', otaId: 'booking' }).ok,
    ).toBe(true);
  });

  it.each(['0', '-1', '101', '1.5', 'abc'])('rechaza tamaño inválido %s', (pageSize) => {
    const result = parseInvoiceSearchInput({
      ...EMPTY_INVOICE_SEARCH,
      channel: 'DIRECT',
      pageSize,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.pageSize).toBeDefined();
  });

  it('exige ambas fechas y rechaza rangos invertidos antes de buscar', () => {
    const incomplete = parseInvoiceSearchInput({
      ...EMPTY_INVOICE_SEARCH,
      issuedFrom: '2026-11-09',
    });
    expect(incomplete.ok).toBe(false);
    if (!incomplete.ok) expect(incomplete.errors.issuedTo).toBeDefined();
    const reversed = parseInvoiceSummaryRange({ issuedFrom: '2026-11-10', issuedTo: '2026-11-09' });
    expect(reversed.ok).toBe(false);
    if (!reversed.ok) expect(reversed.errors.issuedTo).toMatch(/anterior/);
  });

  it('el resumen requiere un período y permite un mismo día inclusivo', () => {
    expect(parseInvoiceSummaryRange({ issuedFrom: '', issuedTo: '' }).ok).toBe(false);
    expect(parseInvoiceSummaryRange({ issuedFrom: '2026-11-09', issuedTo: '2026-11-09' })).toEqual({
      ok: true,
      range: { issuedFrom: '2026-11-09', issuedTo: '2026-11-09' },
    });
  });

  it.each(['2026-02-29', '2026-02-30', '2026-04-31', '2026-13-01', '0000-01-01'])(
    'rechaza fecha civil inexistente %s',
    (date) => {
      expect(isInvoiceDate(date)).toBe(false);
    },
  );

  it('reconoce bisiestos y años inferiores a 100 sin convertirlos en 1900', () => {
    expect(isInvoiceDate('2024-02-29')).toBe(true);
    expect(isInvoiceDate('0001-01-01')).toBe(true);
    expect(isInvoiceDate('0099-12-31')).toBe(true);
  });
});

describe('Importes de factura exactos', () => {
  it.each([
    ['750000.01', '$\u00a0750.000,01\u00a0COP'],
    ['0.00', '$\u00a00,00\u00a0COP'],
    ['-1000.5', '-$\u00a01.000,50\u00a0COP'],
    ['9007199254740993.99', '$\u00a09.007.199.254.740.993,99\u00a0COP'],
    ['999999999999999999999999.01', '$\u00a0999.999.999.999.999.999.999.999,01\u00a0COP'],
  ])('conserva todos los centavos de %s', (amount, expected) => {
    expect(formatInvoiceMoney(amount)).toBe(expected);
  });
});
