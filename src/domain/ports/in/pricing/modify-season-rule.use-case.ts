// Feature 009 · Modificar precio tarifa según temporada
import { Season } from '../../../model/pricing/season';

export const MODIFY_SEASON_RULE_USE_CASE = Symbol('ModifySeasonRuleUseCase');

// Los valores llegan tal como los envía el Administrador; los validan los value objects.
// `actorId` es el `sub` del JWT: quién hace el cambio (FR-004).
export interface CreateSeasonCommand {
  name: unknown;
  color: unknown;
  adjustmentPercent: unknown;
  actorId: string;
}

// Actualización parcial: un campo `undefined` no se toca.
export interface UpdateSeasonCommand {
  seasonId: string;
  name?: unknown;
  color?: unknown;
  adjustmentPercent?: unknown;
  expectedVersion?: number;
  actorId: string;
}

export interface RetireSeasonCommand {
  seasonId: string;
  actorId: string;
}

export interface SeasonCatalog {
  // Instante de la base de datos en que se leyó el catálogo.
  asOf: Date;
  // Solo temporadas no retiradas, ordenadas por nombre normalizado e id.
  seasons: Season[];
}

// GET/POST/PUT/DELETE /admin/season-rules: catálogo de temporadas y su ajuste.
export interface ModifySeasonRuleUseCase {
  list(): Promise<SeasonCatalog>;
  create(command: CreateSeasonCommand): Promise<Season>;
  update(command: UpdateSeasonCommand): Promise<Season>;
  retire(command: RetireSeasonCommand): Promise<void>;
}
