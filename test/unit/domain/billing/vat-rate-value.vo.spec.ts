// Feature 001 · Actualizar porcentaje de IVA
import { InvalidVatRateError } from '../../../../src/domain/errors/billing/invalid-vat-rate.error';
import { VatRateValue } from '../../../../src/domain/model/billing/vat-rate-value.vo';

// T004: rango 0..100 inclusive, a lo sumo 2 decimales, solo como texto (FR-002, NFR-004).
describe('VatRateValue', () => {
  it.each([
    ['0', '0.00'],
    ['100', '100.00'],
    ['19', '19.00'],
    ['19.5', '19.50'],
    ['19.00', '19.00'],
    ['0.01', '0.01'],
    ['99.99', '99.99'],
  ])('acepta %p y lo expresa como %p', (raw, expected) => {
    expect(VatRateValue.of(raw).toString()).toBe(expected);
  });

  it.each([
    ['negativo', '-1'],
    ['mayor a 100', '100.01'],
    ['muy fuera de rango', '120.00'],
    ['más de 2 decimales', '19.555'],
    ['no numérico', 'abc'],
    ['vacío', ''],
    ['con espacios', ' 19'],
    ['notación científica', '1e2'],
    ['con signo +', '+5'],
    ['punto sin decimales', '19.'],
    ['número JSON', 19],
    ['null', null],
    ['ausente', undefined],
  ])('rechaza un valor %s (%p)', (_case, raw) => {
    expect(() => VatRateValue.of(raw)).toThrow(InvalidVatRateError);
  });

  it('el error lleva el código INVALID_VAT_RATE', () => {
    expect(() => VatRateValue.of('120')).toThrow(
      expect.objectContaining({ errorCode: 'INVALID_VAT_RATE' }),
    );
  });

  it('compara por valor exacto, no por formato', () => {
    expect(VatRateValue.of('19').equals(VatRateValue.of('19.00'))).toBe(true);
    expect(VatRateValue.of('19').equals(VatRateValue.of('19.01'))).toBe(false);
  });
});
