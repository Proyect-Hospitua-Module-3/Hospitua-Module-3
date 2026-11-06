// Feature 007 · Generar liquidación (T021)
import { CommissionPercentage } from '../../../../src/domain/model/settlement/commission-percentage.vo';

describe('CommissionPercentage', () => {
  it.each([
    [0, '0.00'],
    [100, '100.00'],
    [15, '15.00'],
    [12.5, '12.50'],
    ['15', '15.00'],
    ['15.5', '15.50'],
    ['15.25', '15.25'],
    ['15.250', '15.25'],
    ['0.00', '0.00'],
    ['100.00', '100.00'],
  ])('acepta %p (límites 0 y 100 incluidos) → %s', (raw, expected) => {
    expect(CommissionPercentage.tryParse(raw)?.toString()).toBe(expected);
  });

  it.each([
    -1,
    -0.01,
    '-5',
    100.01,
    '100.01',
    120,
    '12.345',
    12.345,
    'abc',
    '',
    ' 15',
    '+15',
    '1e1',
    1e-7,
    Number.NaN,
    Number.POSITIVE_INFINITY,
  ])('rechaza %p: negativo, mayor a 100, más de 2 decimales o no numérico', (raw) => {
    expect(CommissionPercentage.tryParse(raw)).toBeNull();
  });
});
