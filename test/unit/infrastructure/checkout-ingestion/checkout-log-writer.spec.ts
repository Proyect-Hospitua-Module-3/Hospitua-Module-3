// Feature 010 · Registrar Check-out (log estructurado, T017)
import { CheckoutLogEntry } from '../../../../src/application/services/checkout-ingestion/register-checkout.service';
import { checkoutLogWriter } from '../../../../src/infrastructure/logging/checkout-ingestion/checkout-log-writer';

function entry(overrides: Partial<CheckoutLogEntry> = {}): CheckoutLogEntry {
  return {
    eventId: 'a5d8b76e-3f91-4c22-b88a-9e67d4f91012',
    stayId: 'd1e4c7b8-2a55-4e31-89d2-b0a112233445',
    outcome: 'PROCESSED',
    errorCode: null,
    durationMs: 42,
    ...overrides,
  };
}

describe('checkoutLogWriter', () => {
  let logger: { log: jest.Mock; warn: jest.Mock };

  beforeEach(() => {
    logger = { log: jest.fn(), warn: jest.fn() };
  });

  it.each(['PROCESSED', 'DUPLICATE'] as const)('%s → log con la entrada en JSON', (outcome) => {
    checkoutLogWriter(logger)(entry({ outcome }));

    expect(JSON.parse(logger.log.mock.calls[0][0])).toEqual(entry({ outcome }));
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it.each(['REJECTED', 'DEAD_LETTER', 'RETRY', 'NACK_REQUEUE'] as const)(
    '%s → advertencia',
    (outcome) => {
      checkoutLogWriter(logger)(entry({ outcome, errorCode: 'MODULE2_UNAVAILABLE' }));

      expect(JSON.parse(logger.warn.mock.calls[0][0])).toEqual(
        expect.objectContaining({ outcome, errorCode: 'MODULE2_UNAVAILABLE' }),
      );
      expect(logger.log).not.toHaveBeenCalled();
    },
  );
});
