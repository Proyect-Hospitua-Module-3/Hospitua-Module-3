// Feature 008 · Gestionar facturación (T010)
// Validación de los parámetros de las tres consultas, antes de tocar la base de datos.
import { InvalidInvoiceQueryError } from '../../../../src/domain/errors/billing/invalid-invoice-query.error';
import { InvalidIssuedDateRangeError } from '../../../../src/domain/errors/billing/invalid-issued-date-range.error';
import { MissingSearchCriteriaError } from '../../../../src/domain/errors/billing/missing-search-criteria.error';
import {
  InvoiceSearchQuery,
  parseInvoiceId,
  parseInvoiceSearch,
  parseInvoiceSummaryRange,
} from '../../../../src/domain/model/billing/invoice-search-criteria';

const STAY_ID = 'c3a9e1b2-5f4d-4e6a-8b7c-1d2e3f4a5b6c';

function expectError(query: InvoiceSearchQuery, error: new (...args: never[]) => Error): void {
  expect(() => parseInvoiceSearch(query)).toThrow(error);
}

describe('parseInvoiceSearch — búsqueda de facturas (FR-001, FR-002)', () => {
  describe('al menos un criterio (FR-002)', () => {
    it('sin ningún parámetro → MISSING_SEARCH_CRITERIA', () => {
      expectError({}, MissingSearchCriteriaError);
    });

    it('page, pageSize, asOf, customerMatch y otaId no cuentan como criterio', () => {
      expectError(
        { page: '2', pageSize: '10', asOf: '2026-12-01T00:00:00Z', customerMatch: 'PARTIAL' },
        MissingSearchCriteriaError,
      );
    });

    it.each([
      ['stayId', { stayId: STAY_ID }],
      ['reservationRef', { reservationRef: 'RES-000123' }],
      ['customerName', { customerName: 'Laura Gómez' }],
      ['customerTaxId', { customerTaxId: '900123456-7' }],
      ['channel', { channel: 'DIRECT' }],
      ['rango de fechas', { issuedFrom: '2026-12-01', issuedTo: '2026-12-31' }],
    ])('%s solo es un criterio válido', (_name, query) => {
      expect(() => parseInvoiceSearch(query)).not.toThrow();
    });

    it('el mensaje dice qué criterios puede usar, sin datos', () => {
      expect(() => parseInvoiceSearch({})).toThrow(
        'Debe indicar al menos un criterio de búsqueda: estancia, reserva, cliente, canal o rango de fechas de emisión.',
      );
    });
  });

  it('devuelve los criterios, la página por defecto (1 de 20) y sin asOf', () => {
    const request = parseInvoiceSearch({
      stayId: STAY_ID,
      reservationRef: 'RES-000123',
      customerTaxId: '900123456-7',
      channel: 'OTA',
      otaId: 'booking',
      issuedFrom: '2026-12-01',
      issuedTo: '2026-12-31',
    });

    expect(request).toEqual({
      criteria: {
        stayId: STAY_ID,
        reservationRef: 'RES-000123',
        customerName: undefined,
        customerTaxId: '900123456-7',
        channel: 'OTA',
        otaId: 'booking',
        issuedRange: { issuedFrom: '2026-12-01', issuedTo: '2026-12-31' },
      },
      page: 1,
      pageSize: 20,
      asOf: undefined,
    });
  });

  describe('rango de fechas (FR-013, SC-007)', () => {
    it('issuedFrom posterior a issuedTo → INVALID_DATE_RANGE', () => {
      expectError(
        { issuedFrom: '2026-12-31', issuedTo: '2026-12-01' },
        InvalidIssuedDateRangeError,
      );
      expect(() =>
        parseInvoiceSearch({ issuedFrom: '2026-12-31', issuedTo: '2026-12-01' }),
      ).toThrow('La fecha de inicio (2026-12-31) es posterior a la fecha de fin (2026-12-01).');
    });

    it('solo una de las dos fechas → INVALID_DATE_RANGE (no MISSING_SEARCH_CRITERIA)', () => {
      expectError({ issuedFrom: '2026-12-01' }, InvalidIssuedDateRangeError);
      expectError({ issuedTo: '2026-12-31', channel: 'OTA' }, InvalidIssuedDateRangeError);
    });

    it('el mismo día como inicio y fin es válido', () => {
      expect(
        parseInvoiceSearch({ issuedFrom: '2026-12-23', issuedTo: '2026-12-23' }).criteria
          .issuedRange,
      ).toEqual({ issuedFrom: '2026-12-23', issuedTo: '2026-12-23' });
    });

    it.each(['2026-12-1', '2026/12/01', '01-12-2026', '2026-02-30', '2026-13-01', 'ayer'])(
      'fecha mal escrita o inexistente (%s) → INVALID_QUERY_PARAMS',
      (date) => {
        expectError({ issuedFrom: date, issuedTo: '2026-12-31' }, InvalidInvoiceQueryError);
      },
    );
  });

  describe('coincidencia del nombre del cliente (caso límite)', () => {
    it('por defecto EXACT, con el nombre sin espacios sobrantes', () => {
      expect(parseInvoiceSearch({ customerName: '  Laura Gómez ' }).criteria.customerName).toEqual({
        value: 'Laura Gómez',
        mode: 'EXACT',
      });
    });

    it('PARTIAL con 3 caracteres o más', () => {
      expect(
        parseInvoiceSearch({ customerName: 'And', customerMatch: 'PARTIAL' }).criteria.customerName,
      ).toEqual({ value: 'And', mode: 'PARTIAL' });
    });

    it('PARTIAL con menos de 3 caracteres → INVALID_QUERY_PARAMS', () => {
      expectError({ customerName: 'An', customerMatch: 'PARTIAL' }, InvalidInvoiceQueryError);
      expectError({ customerName: ' An ', customerMatch: 'PARTIAL' }, InvalidInvoiceQueryError);
    });

    it('EXACT acepta nombres cortos', () => {
      expect(() =>
        parseInvoiceSearch({ customerName: 'Al', customerMatch: 'EXACT' }),
      ).not.toThrow();
    });

    it('customerMatch distinto de EXACT o PARTIAL → INVALID_QUERY_PARAMS', () => {
      expectError({ customerName: 'Laura', customerMatch: 'partial' }, InvalidInvoiceQueryError);
      expectError({ customerName: 'Laura', customerMatch: 'FUZZY' }, InvalidInvoiceQueryError);
    });
  });

  describe('canal y OTA', () => {
    it('channel distinto de DIRECT u OTA → INVALID_QUERY_PARAMS', () => {
      expectError({ channel: 'ota' }, InvalidInvoiceQueryError);
      expectError({ channel: 'BOOKING' }, InvalidInvoiceQueryError);
    });

    it('otaId sin channel=OTA → INVALID_QUERY_PARAMS', () => {
      expectError({ otaId: 'booking', reservationRef: 'RES-1' }, InvalidInvoiceQueryError);
      expectError({ otaId: 'booking', channel: 'DIRECT' }, InvalidInvoiceQueryError);
    });
  });

  describe('formato de los parámetros', () => {
    it('stayId que no es UUID → INVALID_QUERY_PARAMS', () => {
      expectError({ stayId: 'estancia-1' }, InvalidInvoiceQueryError);
    });

    it('un parámetro repetido (llega como arreglo) → INVALID_QUERY_PARAMS', () => {
      expectError({ reservationRef: ['RES-1', 'RES-2'] }, InvalidInvoiceQueryError);
    });

    it('un parámetro vacío → INVALID_QUERY_PARAMS', () => {
      expectError({ reservationRef: '   ' }, InvalidInvoiceQueryError);
      expectError({ customerTaxId: '' }, InvalidInvoiceQueryError);
    });

    it('page y pageSize válidos', () => {
      const request = parseInvoiceSearch({ channel: 'OTA', page: '3', pageSize: '100' });
      expect(request.page).toBe(3);
      expect(request.pageSize).toBe(100);
    });

    it.each([
      ['pageSize', '0'],
      ['pageSize', '101'],
      ['pageSize', '20.5'],
      ['pageSize', 'veinte'],
      ['page', '0'],
      ['page', '-1'],
      ['page', '01'],
      ['page', '10000001'],
    ])('%s = %s → INVALID_QUERY_PARAMS', (name, value) => {
      expectError({ channel: 'OTA', [name]: value }, InvalidInvoiceQueryError);
    });

    it('asOf ISO 8601 con zona', () => {
      expect(parseInvoiceSearch({ channel: 'OTA', asOf: '2026-12-31T23:20:00.000Z' }).asOf).toEqual(
        new Date('2026-12-31T23:20:00.000Z'),
      );
      expect(
        parseInvoiceSearch({ channel: 'OTA', asOf: '2026-12-31T18:20:00.000-05:00' }).asOf,
      ).toEqual(new Date('2026-12-31T23:20:00.000Z'));
    });

    it.each(['2026-12-31', '2026-12-31T23:20:00', 'mañana', '2026-12-31T25:00:00Z'])(
      'asOf sin hora, sin zona o inválido (%s) → INVALID_QUERY_PARAMS',
      (asOf) => {
        expectError({ channel: 'OTA', asOf }, InvalidInvoiceQueryError);
      },
    );

    it('los parámetros mal escritos se rechazan antes que la falta de criterio', () => {
      expectError({ pageSize: '500' }, InvalidInvoiceQueryError);
    });
  });
});

describe('parseInvoiceSummaryRange — resumen por canal (FR-011, FR-013)', () => {
  it('devuelve el rango', () => {
    expect(parseInvoiceSummaryRange({ issuedFrom: '2026-12-01', issuedTo: '2026-12-31' })).toEqual({
      issuedFrom: '2026-12-01',
      issuedTo: '2026-12-31',
    });
  });

  it('sin fechas, o con una sola → INVALID_DATE_RANGE', () => {
    expect(() => parseInvoiceSummaryRange({})).toThrow(InvalidIssuedDateRangeError);
    expect(() => parseInvoiceSummaryRange({ issuedFrom: '2026-12-01' })).toThrow(
      InvalidIssuedDateRangeError,
    );
    expect(() => parseInvoiceSummaryRange({ issuedTo: '2026-12-01' })).toThrow(
      InvalidIssuedDateRangeError,
    );
  });

  it('rango invertido → INVALID_DATE_RANGE', () => {
    expect(() =>
      parseInvoiceSummaryRange({ issuedFrom: '2026-12-31', issuedTo: '2026-12-01' }),
    ).toThrow(InvalidIssuedDateRangeError);
  });

  it('fecha mal escrita → INVALID_QUERY_PARAMS', () => {
    expect(() =>
      parseInvoiceSummaryRange({ issuedFrom: '2026-12-01', issuedTo: '31/12/2026' }),
    ).toThrow(InvalidInvoiceQueryError);
  });
});

describe('parseInvoiceId — detalle', () => {
  it('acepta un UUID y lo pasa a minúsculas', () => {
    expect(parseInvoiceId('7D1C2F0E-4B8A-4C51-9A3E-2F6B1D9C8E01')).toBe(
      '7d1c2f0e-4b8a-4c51-9a3e-2f6b1d9c8e01',
    );
  });

  it.each(['1042', 'factura', '7d1c2f0e-4b8a-4c51-9a3e', undefined])(
    '%s no es un UUID → INVALID_QUERY_PARAMS',
    (invoiceId) => {
      expect(() => parseInvoiceId(invoiceId)).toThrow(InvalidInvoiceQueryError);
    },
  );
});
