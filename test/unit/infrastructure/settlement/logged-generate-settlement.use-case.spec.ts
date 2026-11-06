// Feature 007 · Generar liquidación (T032)
import { Logger } from '@nestjs/common';
import { MissingCommissionError } from '../../../../src/domain/errors/settlement/missing-commission.error';
import { Settlement } from '../../../../src/domain/model/settlement/settlement';
import { GenerateSettlementUseCase } from '../../../../src/domain/ports/in/settlement/generate-settlement.use-case';
import { LoggedGenerateSettlementUseCase } from '../../../../src/infrastructure/logging/settlement/logged-generate-settlement.use-case';
import {
  checkoutCommand,
  EVENT_ID,
  QUOTE_A,
  RESERVATION_REF,
  STAY_ID,
} from '../../../support/settlement/fake-settlement-ports';

describe('LoggedGenerateSettlementUseCase', () => {
  let log: jest.SpyInstance;
  let warn: jest.SpyInstance;
  let clock: number;

  beforeEach(() => {
    log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    clock = 1_000;
  });

  afterEach(() => jest.restoreAllMocks());

  function logged(inner: GenerateSettlementUseCase): LoggedGenerateSettlementUseCase {
    return new LoggedGenerateSettlementUseCase(inner, () => {
      clock += 40;
      return clock;
    });
  }

  it('registra estancia, reserva, canal, cotización, resultado y duración', async () => {
    const settlement = {
      settlementId: '4e2b8c1d-9a7f-4f3e-b6d5-0c1a2b3d4e5f',
      channel: 'OTA',
      quoteId: QUOTE_A,
    } as Settlement;

    await expect(
      logged({ generate: async () => settlement }).generate(checkoutCommand()),
    ).resolves.toBe(settlement);

    expect(JSON.parse(log.mock.calls[0][0] as string)).toEqual({
      eventId: EVENT_ID,
      stayId: STAY_ID,
      reservationRef: RESERVATION_REF,
      result: 'FINAL',
      settlementId: settlement.settlementId,
      channel: 'OTA',
      quoteId: QUOTE_A,
      durationMs: 40,
    });
  });

  it('registra el errorCode de un rechazo y vuelve a lanzar el mismo error', async () => {
    const error = new MissingCommissionError(RESERVATION_REF, 'booking');

    await expect(
      logged({ generate: async () => Promise.reject(error) }).generate(checkoutCommand()),
    ).rejects.toBe(error);

    expect(JSON.parse(warn.mock.calls[0][0] as string)).toMatchObject({
      stayId: STAY_ID,
      result: 'REJECTED',
      errorCode: 'MISSING_COMMISSION',
      durationMs: 40,
    });
  });

  it('un error sin errorCode se registra como UNEXPECTED_ERROR', async () => {
    await expect(
      logged({ generate: async () => Promise.reject(new Error('base caída')) }).generate(
        checkoutCommand(),
      ),
    ).rejects.toThrow('base caída');

    expect(JSON.parse(warn.mock.calls[0][0] as string)).toMatchObject({
      errorCode: 'UNEXPECTED_ERROR',
    });
  });

  it('no registra datos del huésped ni tributarios: solo los campos de trazabilidad', async () => {
    await logged({
      generate: async () =>
        ({ settlementId: 'x', channel: 'DIRECT', quoteId: QUOTE_A }) as Settlement,
    }).generate({ ...checkoutCommand(), billingCustomer: { taxId: '900123456' } } as never);

    expect(log.mock.calls[0][0]).not.toContain('900123456');
  });
});
