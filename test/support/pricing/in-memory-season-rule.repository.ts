// Feature 009 · Modificar precio tarifa según temporada
import { randomUUID } from 'crypto';
import { SeasonNameConflictError } from '../../../src/domain/errors/pricing/season-name-conflict.error';
import { SeasonNotFoundError } from '../../../src/domain/errors/pricing/season-not-found.error';
import { Season, SeasonChanges } from '../../../src/domain/model/pricing/season';
import { SeasonAdjustmentPercent } from '../../../src/domain/model/pricing/season-adjustment-percent.vo';
import { SeasonColor } from '../../../src/domain/model/pricing/season-color.vo';
import { SeasonName } from '../../../src/domain/model/pricing/season-name.vo';
import { SeasonRule } from '../../../src/domain/model/pricing/season-rule';
import { SeasonCatalog } from '../../../src/domain/ports/in/pricing/modify-season-rule.use-case';
import {
  NewSeason,
  SeasonRuleRepositoryPort,
  SeasonRuleSnapshot,
} from '../../../src/domain/ports/out/pricing/season-rule.repository.port';

// Mismo id fijo y mismo usuario "sistema" que usa la migración para crear Regular.
export const REGULAR_ID = '00000000-0000-4000-8000-000000000001';
export const SYSTEM_ACTOR = '00000000-0000-0000-0000-000000000000';

interface StoredSeason {
  id: string;
  name: SeasonName;
  color: SeasonColor;
  isDefault: boolean;
  version: number;
  archivedAt: Date | null;
  updatedBy: string;
  updatedAt: Date;
}

interface StoredRule {
  seasonId: string;
  adjustmentPercent: SeasonAdjustmentPercent;
  validFrom: Date;
  validTo: Date | null;
}

export interface HistoryEntry {
  seasonId: string;
  changeType: 'CREATE' | 'UPDATE' | 'RETIRE';
  previousAdjustment: string | null;
  newAdjustment: string | null;
  previousName: string | null;
  newName: string | null;
  changedBy: string;
}

// Doble de prueba del puerto: mismo comportamiento observable que el repositorio de
// PostgreSQL (nombre único entre activas, versiones, no-op, retiro lógico, snapshot por asOf).
export class InMemorySeasonRuleRepository implements SeasonRuleRepositoryPort {
  readonly seasons = new Map<string, StoredSeason>();
  readonly rules: StoredRule[] = [];
  readonly history: HistoryEntry[] = [];
  private clock = Date.UTC(2026, 9, 1);

  constructor() {
    const now = this.tick();
    this.seasons.set(REGULAR_ID, {
      id: REGULAR_ID,
      name: SeasonName.of('Regular'),
      color: SeasonColor.of('#808080'),
      isDefault: true,
      version: 1,
      archivedAt: null,
      updatedBy: SYSTEM_ACTOR,
      updatedAt: now,
    });
    this.rules.push({
      seasonId: REGULAR_ID,
      adjustmentPercent: SeasonAdjustmentPercent.of('0.00'),
      validFrom: now,
      validTo: null,
    });
  }

  // Reloj simulado: cada operación avanza un segundo, para probar el corte por asOf.
  tick(): Date {
    this.clock += 1000;
    return new Date(this.clock);
  }

  async listActive(): Promise<SeasonCatalog> {
    const seasons = [...this.seasons.values()]
      .filter((s) => !s.archivedAt)
      .sort(byNameThenId)
      .map((s) => this.toDomain(s));
    return { asOf: new Date(this.clock), seasons };
  }

  async create(season: NewSeason, actorId: string): Promise<Season> {
    this.assertNameFree(season.name);
    const now = this.tick();
    const id = randomUUID();
    this.seasons.set(id, {
      id,
      name: season.name,
      color: season.color,
      isDefault: false,
      version: 1,
      archivedAt: null,
      updatedBy: actorId,
      updatedAt: now,
    });
    this.rules.push({
      seasonId: id,
      adjustmentPercent: season.adjustmentPercent,
      validFrom: now,
      validTo: null,
    });
    this.history.push({
      seasonId: id,
      changeType: 'CREATE',
      previousAdjustment: null,
      newAdjustment: season.adjustmentPercent.toString(),
      previousName: null,
      newName: season.name.value,
      changedBy: actorId,
    });
    return this.toDomain(this.seasons.get(id)!);
  }

  async modify(
    seasonId: string,
    actorId: string,
    decide: (current: Season) => SeasonChanges | null,
  ): Promise<Season> {
    const stored = this.requireActive(seasonId);
    const current = this.toDomain(stored);
    const changes = decide(current);
    if (!changes) {
      return current;
    }
    if (changes.name) {
      this.assertNameFree(changes.name, seasonId);
    }

    const now = this.tick();
    const previousRule = this.currentRule(seasonId);
    if (changes.adjustmentPercent) {
      previousRule.validTo = now;
      this.rules.push({
        seasonId,
        adjustmentPercent: changes.adjustmentPercent,
        validFrom: now,
        validTo: null,
      });
    }
    this.history.push({
      seasonId,
      changeType: 'UPDATE',
      previousAdjustment: changes.adjustmentPercent ? previousRule.adjustmentPercent.toString() : null,
      newAdjustment: changes.adjustmentPercent?.toString() ?? null,
      previousName: changes.name ? stored.name.value : null,
      newName: changes.name?.value ?? null,
      changedBy: actorId,
    });
    stored.name = changes.name ?? stored.name;
    stored.color = changes.color ?? stored.color;
    stored.version += 1;
    stored.updatedBy = actorId;
    stored.updatedAt = now;
    return this.toDomain(stored);
  }

  async retire(
    seasonId: string,
    actorId: string,
    authorize: (current: Season) => Promise<void>,
  ): Promise<void> {
    const stored = this.requireActive(seasonId);
    await authorize(this.toDomain(stored));
    const now = this.tick();
    const rule = this.currentRule(seasonId);
    rule.validTo = now;
    stored.archivedAt = now;
    this.history.push({
      seasonId,
      changeType: 'RETIRE',
      previousAdjustment: rule.adjustmentPercent.toString(),
      newAdjustment: null,
      previousName: stored.name.value,
      newName: null,
      changedBy: actorId,
    });
  }

  async findEffectiveAt(asOf: Date): Promise<SeasonRuleSnapshot[]> {
    const snapshots: SeasonRuleSnapshot[] = [];
    for (const season of [...this.seasons.values()].sort(byNameThenId)) {
      const rule = this.rules
        .filter((r) => r.seasonId === season.id && r.validFrom <= asOf)
        .sort((a, b) => b.validFrom.getTime() - a.validFrom.getTime())[0];
      if (!rule) continue;
      snapshots.push({
        seasonId: season.id,
        name: season.name,
        color: season.color,
        isDefault: season.isDefault,
        adjustmentPercent: rule.adjustmentPercent,
        validFrom: rule.validFrom,
        archivedAt: season.archivedAt && season.archivedAt <= asOf ? season.archivedAt : null,
      });
    }
    return snapshots;
  }

  private requireActive(seasonId: string): StoredSeason {
    const stored = this.seasons.get(seasonId);
    if (!stored || stored.archivedAt) {
      throw new SeasonNotFoundError(seasonId);
    }
    return stored;
  }

  private currentRule(seasonId: string): StoredRule {
    return this.rules.find((r) => r.seasonId === seasonId && r.validTo === null)!;
  }

  private assertNameFree(name: SeasonName, exceptId?: string): void {
    const taken = [...this.seasons.values()].some(
      (s) => !s.archivedAt && s.id !== exceptId && s.name.normalized() === name.normalized(),
    );
    if (taken) {
      throw new SeasonNameConflictError(name.value);
    }
  }

  private toDomain(stored: StoredSeason): Season {
    const rule = this.currentRule(stored.id) ?? this.rules.filter((r) => r.seasonId === stored.id).pop()!;
    return new Season(
      stored.id,
      stored.name,
      stored.color,
      stored.isDefault,
      stored.version,
      new SeasonRule(rule.adjustmentPercent, rule.validFrom),
      stored.updatedBy,
      stored.updatedAt,
    );
  }
}

function byNameThenId(a: StoredSeason, b: StoredSeason): number {
  const byName = a.name.normalized().localeCompare(b.name.normalized());
  return byName !== 0 ? byName : a.id.localeCompare(b.id);
}
