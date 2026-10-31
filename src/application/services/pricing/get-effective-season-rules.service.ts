// Feature 009 · Modificar precio tarifa según temporada
import { SeasonCatalogInconsistentError } from '../../../domain/errors/pricing/season-catalog-inconsistent.error';
import { SeasonRulesUnavailableError } from '../../../domain/errors/pricing/season-rules-unavailable.error';
import {
  EffectiveSeasonRules,
  GetEffectiveSeasonRulesUseCase,
} from '../../../domain/ports/in/pricing/get-effective-season-rules.use-case';
import {
  SeasonRuleRepositoryPort,
  SeasonRuleSnapshot,
} from '../../../domain/ports/out/pricing/season-rule.repository.port';

// Puerto interno para 005 y 011. Sin caché: una consulta que empieza después de un
// cambio confirmado ya lo ve (NFR-003); una que empezó antes no lo mezcla (NFR-002).
export class GetEffectiveSeasonRulesService implements GetEffectiveSeasonRulesUseCase {
  constructor(private readonly seasons: SeasonRuleRepositoryPort) {}

  async getAll(asOf: Date): Promise<EffectiveSeasonRules> {
    if (!(asOf instanceof Date) || Number.isNaN(asOf.getTime())) {
      throw new Error('asOf debe ser una fecha válida.');
    }

    let snapshots: SeasonRuleSnapshot[];
    try {
      snapshots = await this.seasons.findEffectiveAt(asOf);
    } catch (cause) {
      throw new SeasonRulesUnavailableError(cause);
    }

    // Nunca se devuelve un snapshot sin una única temporada por defecto (contrato).
    const defaults = snapshots.filter((s) => s.isDefault);
    if (defaults.length !== 1) {
      throw new SeasonCatalogInconsistentError(defaults.length);
    }

    return {
      asOf: asOf.toISOString(),
      defaultSeasonId: defaults[0].seasonId,
      seasons: snapshots.map((s) => ({
        seasonId: s.seasonId,
        name: s.name.value,
        color: s.color.value,
        adjustmentPercent: s.adjustmentPercent.toString(),
        isDefault: s.isDefault,
        validFrom: s.validFrom.toISOString(),
        archivedAt: s.archivedAt ? s.archivedAt.toISOString() : null,
      })),
    };
  }
}
