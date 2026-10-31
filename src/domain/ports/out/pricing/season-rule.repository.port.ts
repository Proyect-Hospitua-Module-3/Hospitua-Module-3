// Feature 009 · Modificar precio tarifa según temporada
import { Season, SeasonChanges } from '../../../model/pricing/season';
import { SeasonAdjustmentPercent } from '../../../model/pricing/season-adjustment-percent.vo';
import { SeasonColor } from '../../../model/pricing/season-color.vo';
import { SeasonName } from '../../../model/pricing/season-name.vo';
import { SeasonCatalog } from '../../in/pricing/modify-season-rule.use-case';

export const SEASON_RULE_REPOSITORY = Symbol('SeasonRuleRepositoryPort');

export interface NewSeason {
  name: SeasonName;
  color: SeasonColor;
  adjustmentPercent: SeasonAdjustmentPercent;
}

// Temporada con la regla que estaba vigente en un instante dado (puede estar retirada).
export interface SeasonRuleSnapshot {
  seasonId: string;
  name: SeasonName;
  color: SeasonColor;
  isDefault: boolean;
  adjustmentPercent: SeasonAdjustmentPercent;
  validFrom: Date;
  archivedAt: Date | null;
}

// Persistencia del catálogo de temporadas, sus versiones de ajuste y su historial.
//
// `modify` y `retire` bloquean la temporada (SELECT … FOR UPDATE) y le entregan el estado
// actual a una función del dominio, que decide; el repositorio aplica esa decisión en la
// misma transacción. Así las reglas de negocio no viven en SQL y no hay carreras entre
// leer y escribir. Si la función lanza un error, la transacción se revierte completa.
export interface SeasonRuleRepositoryPort {
  listActive(): Promise<SeasonCatalog>;

  // Lanza SeasonNameConflictError si el nombre ya lo usa otra temporada no retirada.
  create(season: NewSeason, actorId: string): Promise<Season>;

  // `decide` devuelve los cambios, o null si no cambia nada (no-op: sin versión ni historial).
  // Lanza SeasonNotFoundError si no existe o está retirada, y SeasonNameConflictError.
  modify(
    seasonId: string,
    actorId: string,
    decide: (current: Season) => SeasonChanges | null,
  ): Promise<Season>;

  // `authorize` lanza un error si la temporada no se puede retirar. Retiro lógico:
  // conserva la fila, sus reglas y su historial. Lanza SeasonNotFoundError.
  retire(
    seasonId: string,
    actorId: string,
    authorize: (current: Season) => Promise<void>,
  ): Promise<void>;

  // Una sola lectura consistente: cada temporada existente en `asOf` con la regla que
  // empezó más recientemente antes de `asOf`. Incluye las retiradas.
  findEffectiveAt(asOf: Date): Promise<SeasonRuleSnapshot[]>;
}
