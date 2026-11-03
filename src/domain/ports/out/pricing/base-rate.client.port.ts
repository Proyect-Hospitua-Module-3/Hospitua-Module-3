import { BaseRate } from '../../../model/pricing/base-rate';

export const BASE_RATE_CLIENT = Symbol('BaseRateClientPort');

export interface BaseRateClientPort {
  getBaseRate(roomId: string, date: string): Promise<BaseRate>;
}
