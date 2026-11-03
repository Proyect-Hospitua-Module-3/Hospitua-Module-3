import { InvalidBaseRateError } from '../../errors/pricing/invalid-base-rate.error';
import { Money } from '../shared/money.vo';

export const BASE_RATE_DECIMAL_TEXT_FORMAT = /^-?\d+(\.\d+)?$/;

export function hasAtMostTwoSignificantDecimalPlaces(value: string): boolean {
  const fraction = value.split('.')[1] ?? '';
  return fraction.replace(/0+$/, '').length <= 2;
}

export class BaseRate {
  readonly currency = 'COP';

  private constructor(readonly amount: Money) {}

  static create(rawAmount: unknown): BaseRate {
    if (
      typeof rawAmount !== 'string' ||
      !BASE_RATE_DECIMAL_TEXT_FORMAT.test(rawAmount) ||
      !hasAtMostTwoSignificantDecimalPlaces(rawAmount)
    ) {
      throw new InvalidBaseRateError();
    }
    const amount = Money.of(rawAmount);
    if (!amount.isPositive()) throw new InvalidBaseRateError();
    return new BaseRate(amount);
  }
}
