// Feature 011 · Revisar temporada del año
import {
  EffectiveSeasonRule,
  EffectiveSeasonRules,
} from '../../../src/domain/ports/in/pricing/get-effective-season-rules.use-case';
import { SeasonCatalogQueryPort } from '../../../src/domain/ports/out/pricing/season-catalog-query.port';
import { REGULAR_ID } from './in-memory-season-rule.repository';

// Temporadas fijas para las pruebas de 011.
export const ALTA_ID = '5dca644e-7a6a-4d2e-a9a5-1943188c4710';
export const BAJA_ID = '9b1d3c2e-4f5a-4b6c-8d7e-0f1a2b3c4d5e';
export const EVENTO_ID = 'a2a61e70-57e3-41c4-9dc1-4b124a21a441';
export const RETIRADA_ID = '3c4d5e6f-7a8b-4c9d-8e0f-1a2b3c4d5e6f';

function season(
  seasonId: string,
  name: string,
  color: string,
  adjustmentPercent: string,
  overrides: Partial<EffectiveSeasonRule> = {},
): EffectiveSeasonRule {
  return {
    seasonId,
    name,
    color,
    adjustmentPercent,
    isDefault: false,
    validFrom: '2026-01-01T00:00:00.000Z',
    archivedAt: null,
    ...overrides,
  };
}

// Doble del puerto hacia el catálogo de 009: devuelve siempre el mismo snapshot y
// recuerda con qué instantes se le consultó.
export class FakeSeasonCatalog implements SeasonCatalogQueryPort {
  readonly askedAt: Date[] = [];
  failWith: Error | null = null;
  seasons: EffectiveSeasonRule[] = [
    season(REGULAR_ID, 'Regular', '#808080', '-2.50', { isDefault: true }),
    season(ALTA_ID, 'Temporada alta', '#C0392B', '25.00'),
    season(BAJA_ID, 'Baja', '#2980B9', '-15.00'),
    season(EVENTO_ID, 'Evento especial', '#8E44AD', '50.00'),
    season(RETIRADA_ID, 'Retirada', '#7F8C8D', '10.00', { archivedAt: '2026-06-01T00:00:00.000Z' }),
  ];
  defaultSeasonId = REGULAR_ID;

  async getSnapshot(asOf: Date): Promise<EffectiveSeasonRules> {
    this.askedAt.push(asOf);
    if (this.failWith) {
      throw this.failWith;
    }
    return {
      asOf: asOf.toISOString(),
      defaultSeasonId: this.defaultSeasonId,
      seasons: this.seasons,
    };
  }

  // Para el doble del repositorio: de los ids pedidos, los que existen y no están retirados.
  activeIds(ids: string[]): Set<string> {
    const active = new Set(
      this.seasons.filter((s) => s.archivedAt === null).map((s) => s.seasonId),
    );
    return new Set(ids.filter((id) => active.has(id)));
  }
}
