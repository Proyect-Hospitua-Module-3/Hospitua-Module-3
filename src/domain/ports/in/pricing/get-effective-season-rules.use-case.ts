// Feature 009 · Modificar precio tarifa según temporada
// Contrato: features/009-.../2-technical/contracts/PORT-get-season-rules.md

export const GET_EFFECTIVE_SEASON_RULES_USE_CASE = Symbol('GetEffectiveSeasonRulesUseCase');

export interface EffectiveSeasonRules {
  asOf: string;
  defaultSeasonId: string;
  seasons: EffectiveSeasonRule[];
}

export interface EffectiveSeasonRule {
  seasonId: string;
  name: string;
  color: string;
  // Decimal exacto como texto ("-10.00"); el consumidor no debe usar `number`.
  adjustmentPercent: string;
  isDefault: boolean;
  validFrom: string;
  archivedAt: string | null;
}

// Snapshot del catálogo y de la regla vigente en `asOf`, para 005 (tarifa dinámica)
// y 011 (calendario). Un mismo `asOf` siempre devuelve lo mismo, aunque haya cambios
// concurrentes. Lanza SeasonRulesUnavailableError si la lectura falla y
// SeasonCatalogInconsistentError si no hay exactamente una temporada por defecto.
export interface GetEffectiveSeasonRulesUseCase {
  getAll(asOf: Date): Promise<EffectiveSeasonRules>;
}
