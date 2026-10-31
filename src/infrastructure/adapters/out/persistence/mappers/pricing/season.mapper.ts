// Feature 009 · Modificar precio tarifa según temporada
import { Prisma } from '@prisma/client';
import { Season } from '../../../../../../domain/model/pricing/season';
import { SeasonAdjustmentPercent } from '../../../../../../domain/model/pricing/season-adjustment-percent.vo';
import { SeasonColor } from '../../../../../../domain/model/pricing/season-color.vo';
import { SeasonName } from '../../../../../../domain/model/pricing/season-name.vo';
import { SeasonRule } from '../../../../../../domain/model/pricing/season-rule';
import { SeasonRuleSnapshot } from '../../../../../../domain/ports/out/pricing/season-rule.repository.port';

// Temporada unida a su regla vigente, tal como la devuelven las consultas SQL.
export interface SeasonRow {
  id: string;
  name: string;
  color: string;
  is_default: boolean;
  version: number;
  updated_by: string;
  updated_at: Date;
  rule_id: string;
  adjustment_percent: Prisma.Decimal;
  valid_from: Date;
}

export interface SeasonSnapshotRow {
  id: string;
  name: string;
  color: string;
  is_default: boolean;
  archived_at: Date | null;
  adjustment_percent: Prisma.Decimal;
  valid_from: Date;
}

export class SeasonMapper {
  static toDomain(row: SeasonRow): Season {
    return new Season(
      row.id,
      SeasonName.of(row.name),
      SeasonColor.of(row.color),
      row.is_default,
      row.version,
      new SeasonRule(SeasonAdjustmentPercent.of(row.adjustment_percent.toFixed(2)), row.valid_from),
      row.updated_by,
      row.updated_at,
    );
  }

  static toSnapshot(row: SeasonSnapshotRow): SeasonRuleSnapshot {
    return {
      seasonId: row.id,
      name: SeasonName.of(row.name),
      color: SeasonColor.of(row.color),
      isDefault: row.is_default,
      adjustmentPercent: SeasonAdjustmentPercent.of(row.adjustment_percent.toFixed(2)),
      validFrom: row.valid_from,
      archivedAt: row.archived_at,
    };
  }
}
