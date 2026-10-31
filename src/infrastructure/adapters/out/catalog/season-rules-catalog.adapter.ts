// Feature 011 · Revisar temporada del año
import { Inject, Injectable } from '@nestjs/common';
import {
  EffectiveSeasonRules,
  GET_EFFECTIVE_SEASON_RULES_USE_CASE,
  GetEffectiveSeasonRulesUseCase,
} from '../../../../domain/ports/in/pricing/get-effective-season-rules.use-case';
import { SeasonCatalogQueryPort } from '../../../../domain/ports/out/pricing/season-catalog-query.port';

// 011 lee el catálogo de temporadas solo a través del puerto que 009 expone para 005 y
// 011 (contrato PORT-get-season-rules). Nunca lee las tablas de 009 para mostrar o
// resolver; la única excepción es el bloqueo FOR SHARE al publicar (plan 011, paso 3).
@Injectable()
export class SeasonRulesCatalogAdapter implements SeasonCatalogQueryPort {
  constructor(
    @Inject(GET_EFFECTIVE_SEASON_RULES_USE_CASE)
    private readonly seasonRules: GetEffectiveSeasonRulesUseCase,
  ) {}

  getSnapshot(asOf: Date): Promise<EffectiveSeasonRules> {
    return this.seasonRules.getAll(asOf);
  }
}
