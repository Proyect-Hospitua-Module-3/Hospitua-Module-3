// Feature 005 · Consultar tarifa dinámica (T004)
import { BaseRate } from '../../../../src/domain/model/pricing/base-rate';
import { calculateDynamicRate } from '../../../../src/domain/model/pricing/calculate-dynamic-rate';
import { CalendarDate } from '../../../../src/domain/model/pricing/calendar-date.vo';
import { DynamicRate } from '../../../../src/domain/model/pricing/dynamic-rate';
import { SeasonAdjustmentPercent } from '../../../../src/domain/model/pricing/season-adjustment-percent.vo';
import { Money } from '../../../../src/domain/model/shared/money.vo';

const calculate = (baseRate: string, adjustment: string): string =>
  calculateDynamicRate(Money.of(baseRate), SeasonAdjustmentPercent.of(adjustment)).toString();

describe('calculateDynamicRate', () => {
  it('increases the base rate with a positive adjustment', () => {
    expect(calculate('300000.00', '20.00')).toBe('360000.00');
  });

  it('decreases the base rate with a negative adjustment', () => {
    expect(calculate('300000.00', '-10.00')).toBe('270000.00');
  });

  it('keeps the base rate with a zero adjustment', () => {
    expect(calculate('300000.00', '0.00')).toBe('300000.00');
  });

  it('turns the night into zero with -100.00', () => {
    expect(calculate('300000.00', '-100.00')).toBe('0.00');
  });

  it('doubles the base rate with +100.00', () => {
    expect(calculate('300000.00', '100.00')).toBe('600000.00');
  });

  it('accepts adjustments with two decimals', () => {
    expect(calculate('250000.00', '-15.50')).toBe('211250.00');
  });

  it('rounds half-up to 2 decimals', () => {
    // 10.10 × 1.05 = 10.605 → 10.61 (half-even daría 10.60)
    expect(calculate('10.10', '5.00')).toBe('10.61');
    // 333333.33 × 1.15 = 383333.3295 → 383333.33
    expect(calculate('333333.33', '15.00')).toBe('383333.33');
  });
});

describe('DynamicRate', () => {
  const date = CalendarDate.of('2026-12-24');
  const baseRate = BaseRate.create('300000.00');

  // FR-002, BR-007: el nombre de la temporada nunca cambia el cálculo.
  it.each([
    ['Alta', '20.00', '360000.00'],
    ['Baja', '-10.00', '270000.00'],
    ['Regular', '0.00', '300000.00'],
    ['Regular', '10.00', '330000.00'],
    ['Semana Santa', '35.00', '405000.00'],
    // Mismo nombre que suele subir, con un ajuste negativo: manda el número.
    ['Alta', '-10.00', '270000.00'],
  ])('season %s with %s gives %s', (seasonName, adjustment, expected) => {
    const night = DynamicRate.compute({
      date,
      baseRate,
      seasonName,
      adjustmentPercent: SeasonAdjustmentPercent.of(adjustment),
    });

    expect(night.dynamicRate.toString()).toBe(expected);
  });

  it('keeps the base rate, season and adjustment used, so the value can be traced (FR-009)', () => {
    const night = DynamicRate.compute({
      date,
      baseRate,
      seasonName: 'Alta',
      adjustmentPercent: SeasonAdjustmentPercent.of('20.00'),
    });

    expect(night.date.toString()).toBe('2026-12-24');
    expect(night.baseRate.toString()).toBe('300000.00');
    expect(night.seasonName).toBe('Alta');
    expect(night.adjustmentPercent.toString()).toBe('20.00');
    expect(night.dynamicRate.toString()).toBe('360000.00');
    expect(Object.isFrozen(night)).toBe(true);
  });
});
