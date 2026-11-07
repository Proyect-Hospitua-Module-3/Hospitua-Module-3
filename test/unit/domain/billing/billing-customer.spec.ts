// Feature 006 · Generar factura final (T014)
import { BillingCustomer } from '../../../../src/domain/model/billing/billing-customer';

describe('BillingCustomer', () => {
  it('acepta nombre y documento fiscal completos, sin espacios sobrantes', () => {
    const customer = BillingCustomer.tryFrom({
      name: '  Comercializadora Andina S.A.S. ',
      taxId: ' 900123456-7',
    });

    expect(customer).toEqual(
      expect.objectContaining({ name: 'Comercializadora Andina S.A.S.', taxId: '900123456-7' }),
    );
    expect(Object.isFrozen(customer)).toBe(true);
  });

  it.each([
    ['ausente', undefined],
    ['null', null],
    ['vacío', {}],
    ['sin documento', { name: 'Ana Pérez' }],
    ['sin nombre', { taxId: '900123456-7' }],
    ['nombre en blanco', { name: '   ', taxId: '900123456-7' }],
    ['documento en blanco', { name: 'Ana Pérez', taxId: '' }],
    ['documento que no es texto', { name: 'Ana Pérez', taxId: 900123456 }],
  ])('%s → null (no se emite, sin lanzar)', (_case, input) => {
    expect(BillingCustomer.tryFrom(input as never)).toBeNull();
  });

  it('restore rechaza datos guardados incompletos (integridad)', () => {
    expect(() => BillingCustomer.restore('', '900123456-7')).toThrow();
  });
});
