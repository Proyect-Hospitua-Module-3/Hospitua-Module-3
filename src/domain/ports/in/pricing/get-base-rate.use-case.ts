import { BaseRate } from '../../../model/pricing/base-rate';

export const GET_BASE_RATE_USE_CASE = Symbol('GetBaseRateUseCase');

export interface GetBaseRateUseCase {
  execute(roomId: string, date: string): Promise<BaseRate>;
}
