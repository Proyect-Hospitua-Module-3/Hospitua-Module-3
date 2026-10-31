// Feature 009 · Modificar precio tarifa según temporada
import { InvalidSeasonError } from '../../../../src/domain/errors/pricing/invalid-season.error';
import { SeasonColor } from '../../../../src/domain/model/pricing/season-color.vo';
import { SeasonName } from '../../../../src/domain/model/pricing/season-name.vo';

// T013: nombre y color de la temporada.
describe('SeasonName', () => {
  it('quita los espacios exteriores', () => {
    expect(SeasonName.of('  Festival  ').value).toBe('Festival');
  });

  it('normaliza sin distinguir mayúsculas para la unicidad', () => {
    expect(SeasonName.of('ALTA').normalized()).toBe(SeasonName.of('alta').normalized());
  });

  it.each([
    ['vacío', ''],
    ['solo espacios', '   '],
    ['demasiado largo', 'x'.repeat(51)],
    ['no es texto', 123],
    ['null', null],
  ])('rechaza un nombre %s', (_case, raw) => {
    expect(() => SeasonName.of(raw)).toThrow(InvalidSeasonError);
  });
});

describe('SeasonColor', () => {
  it('acepta #RRGGBB y lo guarda en mayúsculas', () => {
    expect(SeasonColor.of('#c0392b').value).toBe('#C0392B');
  });

  it.each([
    ['sin #', 'C0392B'],
    ['corto', '#C03'],
    ['con letras no hexadecimales', '#GGGGGG'],
    ['nombre de color', 'red'],
    ['no es texto', 0xc0392b],
  ])('rechaza un color %s', (_case, raw) => {
    expect(() => SeasonColor.of(raw)).toThrow(InvalidSeasonError);
  });
});
