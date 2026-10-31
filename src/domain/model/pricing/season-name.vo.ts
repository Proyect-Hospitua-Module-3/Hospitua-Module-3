// Feature 009 · Modificar precio tarifa según temporada
import { InvalidSeasonError } from '../../errors/pricing/invalid-season.error';

// Nombre reservado de la temporada por defecto (FR-001, FR-007).
export const DEFAULT_SEASON_NAME = 'Regular';

const MAX_LENGTH = 50;

// Nombre visible de una temporada. Se guarda sin espacios exteriores; la unicidad se
// compara sin distinguir mayúsculas ("Alta" y "alta" son el mismo nombre).
export class SeasonName {
  private constructor(readonly value: string) {}

  static of(raw: unknown): SeasonName {
    if (typeof raw !== 'string') {
      throw new InvalidSeasonError('El nombre de la temporada debe ser texto.');
    }
    const value = raw.trim();
    if (value === '') {
      throw new InvalidSeasonError('El nombre de la temporada no puede estar vacío.');
    }
    if (value.length > MAX_LENGTH) {
      throw new InvalidSeasonError(
        `El nombre de la temporada admite como máximo ${MAX_LENGTH} caracteres.`,
      );
    }
    return new SeasonName(value);
  }

  // Clave de unicidad: igual a la del índice único de la base de datos (lower(btrim(name))).
  normalized(): string {
    return this.value.toLowerCase();
  }

  equals(other: SeasonName): boolean {
    return this.value === other.value;
  }
}
