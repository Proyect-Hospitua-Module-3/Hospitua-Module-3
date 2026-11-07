import { describe, expect, it } from 'vitest';
import { parseVatInput, vatInputErrorMessage } from './vatInput';

describe('parseVatInput (mismas reglas que VatRateValue del backend)', () => {
  it.each([
    ['19', '19.00'],
    ['16,5', '16.50'],
    ['16.5', '16.50'],
    [' 0 ', '0.00'],
    ['100', '100.00'],
    ['12.25', '12.25'],
    ['12.250', '12.25'],
  ])('acepta %p → %s', (raw, value) => {
    expect(parseVatInput(raw)).toEqual({ ok: true, value });
  });

  it.each([
    ['', 'empty'],
    ['   ', 'empty'],
    ['diecinueve', 'format'],
    ['1e2', 'format'],
    ['19%', 'format'],
    ['-5', 'range'],
    ['−5', 'range'],
    ['100.01', 'range'],
    ['120', 'range'],
    ['12.345', 'decimals'],
  ])('rechaza %p con %s', (raw, error) => {
    expect(parseVatInput(raw)).toEqual({ ok: false, error });
  });
});

describe('vatInputErrorMessage', () => {
  it('dice el rango y que se conserva el vigente (estado 2 del diseño)', () => {
    expect(vatInputErrorMessage('range', '19 %')).toBe(
      'No puede ser negativo ni mayor a 100 %. Se conserva 19 %.',
    );
  });

  it('sin vigente no menciona qué se conserva', () => {
    expect(vatInputErrorMessage('range', null)).toBe('No puede ser negativo ni mayor a 100 %.');
  });
});
