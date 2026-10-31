// Feature 009 · Modificar precio tarifa según temporada
import { InvalidSeasonError } from '../../errors/pricing/invalid-season.error';

const COLOR_FORMAT = /^#[0-9A-Fa-f]{6}$/;

// Color con el que se muestra la temporada (leyenda del calendario de 011): #RRGGBB.
// Se guarda en mayúsculas para que "#c0392b" y "#C0392B" sean el mismo color.
export class SeasonColor {
  private constructor(readonly value: string) {}

  static of(raw: unknown): SeasonColor {
    if (typeof raw !== 'string' || !COLOR_FORMAT.test(raw)) {
      throw new InvalidSeasonError(
        'El color debe tener el formato hexadecimal #RRGGBB (por ejemplo "#C0392B").',
      );
    }
    return new SeasonColor(raw.toUpperCase());
  }

  equals(other: SeasonColor): boolean {
    return this.value === other.value;
  }
}
