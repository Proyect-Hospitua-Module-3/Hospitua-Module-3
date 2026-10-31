// Feature 009 · Modificar precio tarifa según temporada
import { DefaultSeasonImmutableError } from '../../../../src/domain/errors/pricing/default-season-immutable.error';
import { SeasonRuleConflictError } from '../../../../src/domain/errors/pricing/season-rule-conflict.error';
import { Season } from '../../../../src/domain/model/pricing/season';
import { SeasonAdjustmentPercent } from '../../../../src/domain/model/pricing/season-adjustment-percent.vo';
import { SeasonColor } from '../../../../src/domain/model/pricing/season-color.vo';
import { SeasonName } from '../../../../src/domain/model/pricing/season-name.vo';
import { SeasonRule } from '../../../../src/domain/model/pricing/season-rule';

function season(overrides: { name?: string; isDefault?: boolean; version?: number } = {}): Season {
  return new Season(
    'id-1',
    SeasonName.of(overrides.name ?? 'Festival'),
    SeasonColor.of('#C0392B'),
    overrides.isDefault ?? false,
    overrides.version ?? 3,
    new SeasonRule(SeasonAdjustmentPercent.of('25.00'), new Date('2026-10-01T00:00:00Z')),
    'admin',
    new Date('2026-10-01T00:00:00Z'),
  );
}

// T013: reglas de la temporada al decidir un cambio o un retiro.
describe('Season', () => {
  describe('planChange', () => {
    it('devuelve solo lo que cambia de verdad', () => {
      const changes = season().planChange({
        name: SeasonName.of('Festival'),
        adjustmentPercent: SeasonAdjustmentPercent.of('-10'),
      });

      expect(changes).toEqual({ adjustmentPercent: SeasonAdjustmentPercent.of('-10') });
    });

    it('devuelve null si la petición repite los valores actuales (no-op)', () => {
      expect(
        season().planChange({
          name: SeasonName.of(' Festival '),
          color: SeasonColor.of('#c0392b'),
          adjustmentPercent: SeasonAdjustmentPercent.of('25'),
        }),
      ).toBeNull();
    });

    it('rechaza una expectedVersion desactualizada', () => {
      expect(() =>
        season({ version: 3 }).planChange({ color: SeasonColor.of('#000000') }, 2),
      ).toThrow(SeasonRuleConflictError);
    });

    it('acepta la expectedVersion vigente', () => {
      expect(season({ version: 3 }).planChange({ color: SeasonColor.of('#000000') }, 3)).not.toBeNull();
    });

    it('no permite renombrar la temporada por defecto', () => {
      const regular = season({ name: 'Regular', isDefault: true });

      expect(() => regular.planChange({ name: SeasonName.of('Normal') })).toThrow(
        DefaultSeasonImmutableError,
      );
      expect(() => regular.planChange({ name: SeasonName.of('regular') })).toThrow(
        DefaultSeasonImmutableError,
      );
    });

    it('sí permite cambiar el ajuste y el color de la temporada por defecto', () => {
      const regular = season({ name: 'Regular', isDefault: true });

      expect(
        regular.planChange({
          name: SeasonName.of('Regular'),
          color: SeasonColor.of('#000000'),
          adjustmentPercent: SeasonAdjustmentPercent.of('-2.50'),
        }),
      ).toEqual({
        color: SeasonColor.of('#000000'),
        adjustmentPercent: SeasonAdjustmentPercent.of('-2.50'),
      });
    });
  });

  describe('assertCanBeRetired', () => {
    it('la temporada por defecto no se puede retirar', () => {
      expect(() => season({ name: 'Regular', isDefault: true }).assertCanBeRetired()).toThrow(
        DefaultSeasonImmutableError,
      );
    });

    it('cualquier otra temporada sí', () => {
      expect(() => season().assertCanBeRetired()).not.toThrow();
    });
  });
});
