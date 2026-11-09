import { describe, expect, it } from 'vitest';
import { parseSeasonInput } from './seasonInput';

const valid = { name: 'Festival', color: '#C0392B', adjustmentPercent: '25.00' };

describe('parseSeasonInput (reglas de la temporada del backend)', () => {
  it('normaliza espacios, hexadecimal y decimal sin perder precisión', () => {
    expect(
      parseSeasonInput({ name: '  Festival  ', color: ' #c0392b ', adjustmentPercent: ' +025,5 ' }),
    ).toEqual({
      ok: true,
      value: { name: 'Festival', color: '#C0392B', adjustmentPercent: '25.50' },
    });
  });

  it.each([
    ['-100', '-100.00'],
    ['100.00', '100.00'],
    ['+100', '100.00'],
    ['-10,25', '-10.25'],
    ['−0,01', '-0.01'],
    ['0.01', '0.01'],
    ['-0.00', '0.00'],
    ['-0000', '0.00'],
    ['00000000000000000000000000000099.99', '99.99'],
  ])('acepta el ajuste %p y envía %s', (raw, normalized) => {
    expect(parseSeasonInput({ ...valid, adjustmentPercent: raw })).toEqual({
      ok: true,
      value: { ...valid, adjustmentPercent: normalized },
    });
  });

  it.each([
    '',
    ' ',
    '100.01',
    '-100.01',
    '101',
    '-101',
    '1000',
    '99999999999999999999999999999999999999',
    '12.345',
    '12.250',
    '1e2',
    'NaN',
    'Infinity',
    '19%',
    '.5',
    '1.',
    '1,2.3',
    '1 2',
    '--5',
  ])('rechaza el ajuste %p sin redondearlo', (adjustmentPercent) => {
    const result = parseSeasonInput({ ...valid, adjustmentPercent });
    expect(result).toEqual({
      ok: false,
      errors: {
        adjustmentPercent: 'Escribe un porcentaje entre -100 y 100, con hasta 2 decimales.',
      },
    });
  });

  it('acepta nombres de 50 caracteres después de quitar espacios exteriores', () => {
    expect(parseSeasonInput({ ...valid, name: ` ${'a'.repeat(50)} ` })).toEqual({
      ok: true,
      value: { ...valid, name: 'a'.repeat(50) },
    });
  });

  it.each(['', '   ', 'a'.repeat(51)])('rechaza el nombre %p', (name) => {
    const result = parseSeasonInput({ ...valid, name });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.name).toBeTruthy();
  });

  it.each(['red', '#FFF', '#FFFFFFFF', 'C0392B', '#C0392Z', ''])('rechaza el color %p', (color) => {
    const result = parseSeasonInput({ ...valid, color });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.color).toBeTruthy();
  });

  it('devuelve todos los campos inválidos para corregirlos en el mismo intento', () => {
    const result = parseSeasonInput({ name: '', color: '#bad', adjustmentPercent: '100.01' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(Object.keys(result.errors)).toEqual(['name', 'color', 'adjustmentPercent']);
    }
  });
});
