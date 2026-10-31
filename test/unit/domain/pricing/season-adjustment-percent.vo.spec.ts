// Feature 009 · Modificar precio tarifa según temporada
import { InvalidSeasonAdjustmentError } from '../../../../src/domain/errors/pricing/invalid-season-adjustment.error';
import { SeasonAdjustmentPercent } from '../../../../src/domain/model/pricing/season-adjustment-percent.vo';

// T012: porcentaje firmado -100..100 inclusive, a lo sumo 2 decimales, solo como texto.
describe('SeasonAdjustmentPercent', () => {
  it.each([
    ['-100', '-100.00'],
    ['-100.00', '-100.00'],
    ['100', '100.00'],
    ['0', '0.00'],
    ['-0', '0.00'],
    ['+20', '20.00'],
    ['20.5', '20.50'],
    ['-10.00', '-10.00'],
    ['-2.50', '-2.50'],
    ['99.99', '99.99'],
  ])('acepta %p y lo expresa como %p', (raw, expected) => {
    expect(SeasonAdjustmentPercent.of(raw).toString()).toBe(expected);
  });

  it.each([
    ['menor a -100', '-100.01'],
    ['mayor a 100', '100.01'],
    ['muy fuera de rango', '250'],
    ['más de 2 decimales', '12.345'],
    ['no numérico', 'veinte'],
    ['vacío', ''],
    ['con espacios', ' 20'],
    ['notación científica', '1e2'],
    ['NaN', 'NaN'],
    ['infinito', 'Infinity'],
    ['punto sin decimales', '20.'],
    ['número JSON', 20],
    ['null', null],
    ['ausente', undefined],
  ])('rechaza un valor %s (%p)', (_case, raw) => {
    expect(() => SeasonAdjustmentPercent.of(raw)).toThrow(InvalidSeasonAdjustmentError);
  });

  it('el error lleva el código INVALID_SEASON_ADJUSTMENT', () => {
    expect(() => SeasonAdjustmentPercent.of('101')).toThrow(
      expect.objectContaining({ errorCode: 'INVALID_SEASON_ADJUSTMENT' }),
    );
  });

  it('compara por valor exacto, no por formato', () => {
    expect(SeasonAdjustmentPercent.of('20').equals(SeasonAdjustmentPercent.of('+20.00'))).toBe(true);
    expect(SeasonAdjustmentPercent.of('20').equals(SeasonAdjustmentPercent.of('-20'))).toBe(false);
  });
});
