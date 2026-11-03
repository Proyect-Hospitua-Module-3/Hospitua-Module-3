// Feature 011 · Revisar temporada del año
import { SeasonCatalogLookup } from '../../../domain/model/pricing/season-calendar';
import {
  EffectiveSeasonRule,
  EffectiveSeasonRules,
} from '../../../domain/ports/in/pricing/get-effective-season-rules.use-case';

export interface IndexedSeasonCatalog extends SeasonCatalogLookup {
  get(seasonId: string): EffectiveSeasonRule | undefined;
}

// Índice por id del snapshot de 009. Incluye las temporadas retiradas antes del instante
// del snapshot: así una revisión histórica puede seguir mostrando su nombre y color.
export function indexSeasonCatalog(rules: EffectiveSeasonRules): IndexedSeasonCatalog {
  const byId = new Map(rules.seasons.map((season) => [season.seasonId, season]));
  return {
    defaultSeasonId: rules.defaultSeasonId,
    has: (seasonId) => byId.has(seasonId),
    get: (seasonId) => byId.get(seasonId),
  };
}
