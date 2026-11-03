import { ConfigService } from '@nestjs/config';
import { HttpModule } from '@nestjs/axios';
import { Test, TestingModule } from '@nestjs/testing';
import { Module1BaseRateClient } from '../../../src/infrastructure/adapters/out/http/module1-base-rate.client';
import { Module1HttpFixture, Module1Reply } from '../../support/pricing/module1-http-fixture';

const ROOM_ID = '550e8400-e29b-41d4-a716-446655440000';
const DATE = '2026-10-08';
const SUCCESS = { roomId: ROOM_ID, date: DATE, baseRate: '250000.00', currency: 'COP' };

describe('Module 1 base-rate contract', () => {
  let fixture: Module1HttpFixture;
  let moduleRef: TestingModule;
  let client: Module1BaseRateClient;

  beforeEach(async () => {
    fixture = new Module1HttpFixture();
    await fixture.start();
    moduleRef = await Test.createTestingModule({
      imports: [HttpModule.register({})],
      providers: [
        Module1BaseRateClient,
        {
          provide: ConfigService,
          useValue: {
            get: (name: string) =>
              name === 'MODULE1_BASE_URL'
                ? fixture.baseUrl
                : name === 'MODULE1_TIMEOUT_MS'
                  ? '500'
                  : undefined,
          },
        },
      ],
    }).compile();
    client = moduleRef.get(Module1BaseRateClient);
  });

  afterEach(async () => {
    jest.useRealTimers();
    await moduleRef?.close();
    await fixture.stop();
  });

  it('accepts a valid success body and ignores additional fields', async () => {
    fixture.setReply({ status: 200, body: { ...SUCCESS, details: { version: 2 } } });

    const actual = await client.getBaseRate(ROOM_ID, DATE);

    expect(actual.amount.toString()).toBe('250000.00');
    expect(actual.currency).toBe('COP');
  });

  it('maps structured ROOM_NOT_FOUND with additional fields to ROOM_NOT_FOUND', async () => {
    fixture.setReply({
      status: 404,
      body: { errorCode: 'ROOM_NOT_FOUND', message: 'missing', details: {} },
    });

    await expect(client.getBaseRate(ROOM_ID, DATE)).rejects.toMatchObject({
      errorCode: 'ROOM_NOT_FOUND',
    });
  });

  it('maps non-positive decimal text to INVALID_BASE_RATE', async () => {
    fixture.setReply({ status: 200, body: { ...SUCCESS, baseRate: '-0.01' } });

    await expect(client.getBaseRate(ROOM_ID, DATE)).rejects.toMatchObject({
      errorCode: 'INVALID_BASE_RATE',
    });
  });

  it.each([
    ['malformed body', { status: 200, rawBody: 'not-json' }],
    ['404 without ROOM_NOT_FOUND', { status: 404, body: { errorCode: 'OTHER' } }],
    ['other 4xx', { status: 400, body: {} }],
    ['5xx', { status: 503, body: {} }],
    ['wrong currency', { status: 200, body: { ...SUCCESS, currency: 'USD' } }],
    [
      'baseRate with more than two significant decimal places',
      { status: 200, body: { ...SUCCESS, baseRate: '250000.505' } },
    ],
  ] as Array<[string, Module1Reply]>)('maps %s to MODULE1_UNAVAILABLE', async (_label, reply) => {
    fixture.setReply(reply);

    await expect(client.getBaseRate(ROOM_ID, DATE)).rejects.toMatchObject({
      errorCode: 'MODULE1_UNAVAILABLE',
    });
  });
});
