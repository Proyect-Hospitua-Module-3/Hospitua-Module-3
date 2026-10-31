// Feature 009 · Modificar precio tarifa según temporada
import { DefaultSeasonImmutableError } from '../../errors/pricing/default-season-immutable.error';
import { SeasonRuleConflictError } from '../../errors/pricing/season-rule-conflict.error';
import { SeasonAdjustmentPercent } from './season-adjustment-percent.vo';
import { SeasonColor } from './season-color.vo';
import { SeasonName } from './season-name.vo';
import { SeasonRule } from './season-rule';

// Lo que el Administrador pide cambiar; un campo ausente no se toca.
export interface SeasonChangeRequest {
  name?: SeasonName;
  color?: SeasonColor;
  adjustmentPercent?: SeasonAdjustmentPercent;
}

// Lo que de verdad cambia frente al estado actual.
export type SeasonChanges = SeasonChangeRequest;

// Temporada del catálogo con su regla vigente. El id es estable: no cambia al renombrar,
// porque es lo que referencia el calendario de 011.
export class Season {
  constructor(
    readonly id: string,
    readonly name: SeasonName,
    readonly color: SeasonColor,
    readonly isDefault: boolean,
    readonly version: number,
    readonly currentRule: SeasonRule,
    readonly updatedBy: string,
    readonly updatedAt: Date,
  ) {}

  // Decide qué cambia de verdad. Devuelve null si la petición repite los valores
  // actuales: es un no-op válido que no crea versión ni historial (casos límite de la spec).
  planChange(request: SeasonChangeRequest, expectedVersion?: number): SeasonChanges | null {
    if (expectedVersion !== undefined && expectedVersion !== this.version) {
      throw new SeasonRuleConflictError(this.version);
    }
    if (this.isDefault && request.name && !request.name.equals(this.name)) {
      throw new DefaultSeasonImmutableError('renombrar');
    }

    const changes: SeasonChanges = {};
    if (request.name && !request.name.equals(this.name)) {
      changes.name = request.name;
    }
    if (request.color && !request.color.equals(this.color)) {
      changes.color = request.color;
    }
    if (
      request.adjustmentPercent &&
      !request.adjustmentPercent.equals(this.currentRule.adjustmentPercent)
    ) {
      changes.adjustmentPercent = request.adjustmentPercent;
    }
    return Object.keys(changes).length > 0 ? changes : null;
  }

  // Regular no se retira nunca (FR-001). Las referencias del calendario las revisa el servicio.
  assertCanBeRetired(): void {
    if (this.isDefault) {
      throw new DefaultSeasonImmutableError('retirar');
    }
  }
}
