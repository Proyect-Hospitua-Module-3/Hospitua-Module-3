// Feature 005 · Consultar tarifa dinámica (T046)
import { Logger } from '@nestjs/common';
import { RoomNotFoundError } from '../../../../src/domain/errors/pricing/room-not-found.error';
import { LodgingQuote } from '../../../../src/domain/model/pricing/lodging-quote';
import {
  CreateLodgingQuoteCommand,
  CreateLodgingQuoteUseCase,
} from '../../../../src/domain/ports/in/pricing/create-lodging-quote.use-case';
import { LoggedCreateLodgingQuoteUseCase } from '../../../../src/infrastructure/logging/pricing/logged-create-lodging-quote.use-case';

const ROOM_ID = '3f2b8c1e-5a47-4d09-9b6e-1c2d3e4f5a6b';
const QUOTE_ID = 'a1f2c3d4-e5b6-4789-8a9b-0c1d2e3f4a5b';

const command: CreateLodgingQuoteCommand = {
  roomId: ROOM_ID,
  checkInDate: '2026-12-23',
  checkOutDate: '2026-12-26',
};

// Ejemplo del contrato POST: 3 noches, Regular y dos de Alta.
const quote = LodgingQuote.restore({
  quoteId: QUOTE_ID,
  roomId: ROOM_ID,
  checkInDate: '2026-12-23',
  checkOutDate: '2026-12-26',
  currency: 'COP',
  lodgingAmount: '1020000.00',
  nights: [
    {
      date: '2026-12-23',
      baseRate: '300000.00',
      seasonName: 'Regular',
      adjustmentPercent: '0.00',
      rate: '300000.00',
    },
    {
      date: '2026-12-24',
      baseRate: '300000.00',
      seasonName: 'Alta',
      adjustmentPercent: '20.00',
      rate: '360000.00',
    },
    {
      date: '2026-12-25',
      baseRate: '300000.00',
      seasonName: 'Alta',
      adjustmentPercent: '20.00',
      rate: '360000.00',
    },
  ],
});

describe('LoggedCreateLodgingQuoteUseCase', () => {
  let log: jest.SpyInstance;
  let warn: jest.SpyInstance;
  let clock: number;

  beforeEach(() => {
    log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    clock = 1_000;
  });

  afterEach(() => jest.restoreAllMocks());

  function logged(inner: CreateLodgingQuoteUseCase): LoggedCreateLodgingQuoteUseCase {
    return new LoggedCreateLodgingQuoteUseCase(inner, () => {
      clock += 25;
      return clock;
    });
  }

  it('registra quoteId, roomId, rango, total y duración, y devuelve la misma cotización', async () => {
    await expect(logged({ create: async () => quote }).create(command)).resolves.toBe(quote);

    expect(log).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();
    expect(JSON.parse(log.mock.calls[0][0] as string)).toEqual({
      result: 'CREATED',
      quoteId: QUOTE_ID,
      roomId: ROOM_ID,
      checkInDate: '2026-12-23',
      checkOutDate: '2026-12-26',
      lodgingAmount: '1020000.00',
      durationMs: 25,
    });
  });

  it('no registra el detalle por noche: solo el total', async () => {
    await logged({ create: async () => quote }).create(command);

    const line = log.mock.calls[0][0] as string;
    expect(line).not.toContain('nights');
    expect(line).not.toContain('Alta');
  });

  it('registra el errorCode de un rechazo, con lo que se pidió, y vuelve a lanzar el mismo error', async () => {
    const error = new RoomNotFoundError();

    await expect(
      logged({ create: async () => Promise.reject(error) }).create(command),
    ).rejects.toBe(error);

    expect(log).not.toHaveBeenCalled();
    expect(JSON.parse(warn.mock.calls[0][0] as string)).toEqual({
      result: 'REJECTED',
      roomId: ROOM_ID,
      checkInDate: '2026-12-23',
      checkOutDate: '2026-12-26',
      errorCode: 'ROOM_NOT_FOUND',
      durationMs: 25,
    });
  });

  it('un error sin errorCode se registra como UNEXPECTED_ERROR', async () => {
    await expect(
      logged({ create: async () => Promise.reject(new Error('base caída')) }).create(command),
    ).rejects.toThrow('base caída');

    expect(JSON.parse(warn.mock.calls[0][0] as string)).toMatchObject({
      result: 'REJECTED',
      errorCode: 'UNEXPECTED_ERROR',
    });
  });
});
