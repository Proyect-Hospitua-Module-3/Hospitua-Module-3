// Feature 006 · Generar factura final (T034, T035)
import { Logger } from '@nestjs/common';
import { VatRateNotConfiguredError } from '../../../../src/domain/errors/billing/vat-rate-not-configured.error';
import { Invoice } from '../../../../src/domain/model/billing/invoice';
import {
  GenerateFinalInvoiceResult,
  GenerateFinalInvoiceUseCase,
} from '../../../../src/domain/ports/in/billing/generate-final-invoice.use-case';
import { LoggedGenerateFinalInvoiceUseCase } from '../../../../src/infrastructure/logging/billing/logged-generate-final-invoice.use-case';
import {
  CUSTOMER,
  EVENT_ID,
  INVOICE_ID,
  invoiceCommand,
  SETTLEMENT_ID,
  STAY_ID,
} from '../../../support/billing/fake-invoice-ports';

describe('LoggedGenerateFinalInvoiceUseCase', () => {
  let log: jest.SpyInstance;
  let warn: jest.SpyInstance;
  let clock: number;

  beforeEach(() => {
    log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    clock = 1_000;
  });

  afterEach(() => jest.restoreAllMocks());

  function logged(inner: GenerateFinalInvoiceUseCase): LoggedGenerateFinalInvoiceUseCase {
    return new LoggedGenerateFinalInvoiceUseCase(inner, () => {
      clock += 25;
      return clock;
    });
  }

  function lastEntry(spy: jest.SpyInstance): Record<string, unknown> {
    return JSON.parse(spy.mock.calls.at(-1)?.[0] as string);
  }

  it('ISSUED: registra evento, estancia, liquidación, factura, número y duración', async () => {
    const result: GenerateFinalInvoiceResult = {
      status: 'ISSUED',
      invoice: {
        invoiceId: INVOICE_ID,
        invoiceNumber: 1042,
        settlementId: SETTLEMENT_ID,
      } as Invoice,
    };

    await expect(logged({ generate: async () => result }).generate(invoiceCommand())).resolves.toBe(
      result,
    );

    expect(lastEntry(log)).toEqual({
      eventId: EVENT_ID,
      stayId: STAY_ID,
      result: 'ISSUED',
      settlementId: SETTLEMENT_ID,
      invoiceId: INVOICE_ID,
      invoiceNumber: 1042,
      durationMs: 25,
    });
  });

  it('NOT_ISSUED: registra el motivo como advertencia', async () => {
    await logged({
      generate: async () => ({ status: 'NOT_ISSUED', reason: 'BILLING_CUSTOMER_DATA_MISSING' }),
    }).generate(invoiceCommand());

    expect(lastEntry(warn)).toEqual(
      expect.objectContaining({ result: 'NOT_ISSUED', reason: 'BILLING_CUSTOMER_DATA_MISSING' }),
    );
  });

  it('error: registra el errorCode y lo vuelve a lanzar', async () => {
    const error = new VatRateNotConfiguredError();

    await expect(
      logged({ generate: async () => Promise.reject(error) }).generate(invoiceCommand()),
    ).rejects.toBe(error);

    expect(lastEntry(warn)).toEqual(
      expect.objectContaining({ result: 'REJECTED', errorCode: 'VAT_RATE_NOT_CONFIGURED' }),
    );
  });

  it('un error sin errorCode sale como UNEXPECTED_ERROR', async () => {
    await expect(
      logged({ generate: async () => Promise.reject(new Error('x')) }).generate(invoiceCommand()),
    ).rejects.toThrow('x');

    expect(lastEntry(warn)).toEqual(expect.objectContaining({ errorCode: 'UNEXPECTED_ERROR' }));
  });

  it('nunca registra el nombre ni el documento fiscal del cliente (NFR-005)', async () => {
    await logged({
      generate: async () => ({ status: 'NOT_ISSUED', reason: 'BILLING_CUSTOMER_DATA_MISSING' }),
    }).generate(invoiceCommand());
    await logged({ generate: async () => Promise.reject(new Error('x')) })
      .generate(invoiceCommand())
      .catch(() => undefined);

    const everything = JSON.stringify([...log.mock.calls, ...warn.mock.calls]);
    expect(everything).not.toContain(CUSTOMER.name);
    expect(everything).not.toContain(CUSTOMER.taxId);
  });
});
