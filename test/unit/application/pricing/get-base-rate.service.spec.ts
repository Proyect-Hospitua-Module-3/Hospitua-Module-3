// Feature 004 · Consultar tarifa base
import { InvalidBaseRateQueryError } from '../../../../src/domain/errors/pricing/invalid-base-rate-query.error';
import { BaseRate } from '../../../../src/domain/model/pricing/base-rate';
import { BaseRateClientPort } from '../../../../src/domain/ports/out/pricing/base-rate.client.port';
import { GetBaseRateService } from '../../../../src/application/services/pricing/get-base-rate.service';

describe('GetBaseRateService', () => {
  const roomId = '550e8400-e29b-41d4-a716-446655440000';
  let client: jest.Mocked<BaseRateClientPort>;
  let service: GetBaseRateService;

  beforeEach(() => {
    client = { getBaseRate: jest.fn() };
    service = new GetBaseRateService(client);
  });

  it('returns the rate received from Module 1', async () => {
    const rate = BaseRate.create('250000.00');
    client.getBaseRate.mockResolvedValue(rate);

    await expect(service.execute(roomId, '2026-10-08')).resolves.toBe(rate);
  });

  it('returns the same amount for identical queries when Module 1 returns the same rate', async () => {
    const rate = BaseRate.create('250000.00');
    client.getBaseRate.mockResolvedValue(rate);

    const first = await service.execute(roomId, '2026-10-08');
    const second = await service.execute(roomId, '2026-10-08');

    expect(first.amount.toString()).toBe('250000.00');
    expect(second.amount.toString()).toBe('250000.00');
    expect(second.amount.toString()).toBe(first.amount.toString());
    expect(client.getBaseRate).toHaveBeenNthCalledWith(1, roomId, '2026-10-08');
    expect(client.getBaseRate).toHaveBeenNthCalledWith(2, roomId, '2026-10-08');
  });

  it('queries each date independently and observes successive values', async () => {
    client.getBaseRate
      .mockResolvedValueOnce(BaseRate.create('250000.00'))
      .mockResolvedValueOnce(BaseRate.create('275000.00'))
      .mockResolvedValueOnce(BaseRate.create('300000.00'));

    const first = await service.execute(roomId, '2026-10-08');
    const second = await service.execute(roomId, '2026-10-09');
    const updated = await service.execute(roomId, '2026-10-08');

    expect([first.amount.toString(), second.amount.toString(), updated.amount.toString()]).toEqual([
      '250000.00',
      '275000.00',
      '300000.00',
    ]);
    expect(client.getBaseRate).toHaveBeenNthCalledWith(1, roomId, '2026-10-08');
    expect(client.getBaseRate).toHaveBeenNthCalledWith(2, roomId, '2026-10-09');
    expect(client.getBaseRate).toHaveBeenNthCalledWith(3, roomId, '2026-10-08');
  });

  it.each([
    ['roomId', 'not-a-uuid', '2026-10-08'],
    ['date', roomId, '2026-02-30'],
    ['date format', roomId, '08-10-2026'],
  ])('rejects invalid %s without calling Module 1', async (_label, invalidRoomId, date) => {
    await expect(service.execute(invalidRoomId, date)).rejects.toBeInstanceOf(
      InvalidBaseRateQueryError,
    );
    expect(client.getBaseRate).not.toHaveBeenCalled();
  });

  it.each([
    ['empty roomId', '', '2026-10-08'],
    ['roomId with extra characters', `${roomId}x`, '2026-10-08'],
    ['month 13', roomId, '2026-13-01'],
    ['non-padded date', roomId, '2026-1-1'],
    ['empty date', roomId, ''],
  ])(
    'rejects %s with INVALID_QUERY_PARAMS without calling Module 1',
    async (_label, invalidRoomId, date) => {
      await expect(service.execute(invalidRoomId, date)).rejects.toMatchObject({
        errorCode: 'INVALID_QUERY_PARAMS',
      });
      expect(client.getBaseRate).not.toHaveBeenCalled();
    },
  );

  it('accepts an uppercase roomId and a valid leap day', async () => {
    const rate = BaseRate.create('250000.00');
    client.getBaseRate.mockResolvedValue(rate);

    await expect(service.execute(roomId.toUpperCase(), '2028-02-29')).resolves.toBe(rate);
  });
});
