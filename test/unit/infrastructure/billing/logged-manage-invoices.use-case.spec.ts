// Feature 008 · Gestionar facturación (T037)
// Log estructurado de cada consulta, sin datos personales del cliente.
import { Logger } from '@nestjs/common';
import { InvoiceNotFoundError } from '../../../../src/domain/errors/billing/invoice-not-found.error';
import { ManageInvoicesUseCase } from '../../../../src/domain/ports/in/billing/manage-invoices.use-case';
import { LoggedManageInvoicesUseCase } from '../../../../src/infrastructure/logging/billing/logged-manage-invoices.use-case';
import { DB_NOW, otaInvoice } from '../../../support/billing/in-memory-invoice-query';

const ADMIN = 'f2d3b4a5-6c7d-4e8f-9012-3456789abcde';

describe('LoggedManageInvoicesUseCase', () => {
  let info: jest.SpyInstance;
  let warn: jest.SpyInstance;

  beforeEach(() => {
    info = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  function logged(inner: Partial<ManageInvoicesUseCase>): LoggedManageInvoicesUseCase {
    let clock = 0;
    return new LoggedManageInvoicesUseCase(inner as ManageInvoicesUseCase, () => (clock += 5));
  }

  it('búsqueda: quién, qué criterios usó y cuántos resultados, sin el nombre ni el documento', async () => {
    const useCase = logged({
      search: async () => ({
        items: [],
        page: 1,
        pageSize: 20,
        totalItems: 0,
        totalPages: 0,
        asOf: DB_NOW,
        resultStatus: 'NO_MATCHES',
        customerMatchMode: 'PARTIAL',
      }),
    });

    await useCase.search(
      { customerName: 'Laura Gómez', customerTaxId: '52123456', customerMatch: 'PARTIAL' },
      ADMIN,
    );

    const entry = JSON.parse(info.mock.calls[0][0]);
    expect(entry).toEqual({
      operation: 'SEARCH',
      requestedBy: ADMIN,
      criteria: ['customerName', 'customerTaxId'],
      result: 'OK',
      resultStatus: 'NO_MATCHES',
      totalItems: 0,
      page: 1,
      returned: 0,
      durationMs: 5,
    });
    expect(info.mock.calls[0][0]).not.toContain('Laura');
    expect(info.mock.calls[0][0]).not.toContain('52123456');
  });

  it('detalle: el id y el número oficial', async () => {
    const invoice = otaInvoice({ invoiceNumber: 1042 });
    await logged({ getDetail: async () => invoice }).getDetail(invoice.invoiceId, ADMIN);

    expect(JSON.parse(info.mock.calls[0][0])).toMatchObject({
      operation: 'DETAIL',
      invoiceId: invoice.invoiceId,
      invoiceNumber: 1042,
      result: 'OK',
    });
    expect(info.mock.calls[0][0]).not.toContain(invoice.customerName);
  });

  it('un error queda como REJECTED con su errorCode y se vuelve a lanzar', async () => {
    const error = new InvoiceNotFoundError('7d1c2f0e-4b8a-4c51-9a3e-2f6b1d9c8e01');
    const useCase = logged({
      getDetail: async () => {
        throw error;
      },
    });

    await expect(useCase.getDetail('7d1c2f0e-4b8a-4c51-9a3e-2f6b1d9c8e01', ADMIN)).rejects.toBe(
      error,
    );
    expect(JSON.parse(warn.mock.calls[0][0])).toMatchObject({
      operation: 'DETAIL',
      result: 'REJECTED',
      errorCode: 'INVOICE_NOT_FOUND',
    });
  });

  it('resumen: rango, canales y total de facturas', async () => {
    await logged({
      summarizeByChannel: async () => ({
        range: { issuedFrom: '2026-12-01', issuedTo: '2026-12-31' },
        timezone: 'America/Bogota',
        currency: 'COP',
        channels: [
          {
            channel: 'DIRECT',
            otaId: null,
            invoiceCount: 2,
            totalLodging: '0.00',
            totalOtaCommission: '0.00',
            totalVat: '0.00',
            totalInvoiced: '0.00',
          },
          {
            channel: 'OTA',
            otaId: 'booking',
            invoiceCount: 3,
            totalLodging: '0.00',
            totalOtaCommission: '0.00',
            totalVat: '0.00',
            totalInvoiced: '0.00',
          },
        ],
      }),
    }).summarizeByChannel({ issuedFrom: '2026-12-01', issuedTo: '2026-12-31' }, ADMIN);

    expect(JSON.parse(info.mock.calls[0][0])).toMatchObject({
      operation: 'SUMMARY',
      issuedFrom: '2026-12-01',
      issuedTo: '2026-12-31',
      channels: 2,
      invoiceCount: 5,
    });
  });
});
