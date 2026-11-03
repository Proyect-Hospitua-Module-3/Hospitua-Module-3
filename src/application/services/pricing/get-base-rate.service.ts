import { InvalidBaseRateQueryError } from '../../../domain/errors/pricing/invalid-base-rate-query.error';
import { BaseRate } from '../../../domain/model/pricing/base-rate';
import { GetBaseRateUseCase } from '../../../domain/ports/in/pricing/get-base-rate.use-case';
import { BaseRateClientPort } from '../../../domain/ports/out/pricing/base-rate.client.port';

const UUID_FORMAT = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_DATE_FORMAT = /^\d{4}-\d{2}-\d{2}$/;

export class GetBaseRateService implements GetBaseRateUseCase {
  constructor(private readonly client: BaseRateClientPort) {}

  async execute(roomId: string, date: string): Promise<BaseRate> {
    if (!UUID_FORMAT.test(roomId) || !this.isValidDate(date)) {
      throw new InvalidBaseRateQueryError();
    }
    return this.client.getBaseRate(roomId, date);
  }

  private isValidDate(value: string): boolean {
    if (!ISO_DATE_FORMAT.test(value)) return false;
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }
}
