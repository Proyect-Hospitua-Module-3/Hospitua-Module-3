// Feature 011 · Revisar temporada del año
import { EffectiveSeasonRules } from '../../in/pricing/get-effective-season-rules.use-case';

export const SEASON_CATALOG_QUERY = Symbol('SeasonCatalogQueryPort');

// Consulta de solo lectura al catálogo de temporadas de 009 (ids, default, nombre, color
// y ajuste) en un instante. 011 no copia esos datos: los adjunta al leer el calendario.
// Errores: los del puerto GetEffectiveSeasonRulesUseCase de 009
// (SeasonRulesUnavailableError, SeasonCatalogInconsistentError).
export interface SeasonCatalogQueryPort {
  getSnapshot(asOf: Date): Promise<EffectiveSeasonRules>;
}
