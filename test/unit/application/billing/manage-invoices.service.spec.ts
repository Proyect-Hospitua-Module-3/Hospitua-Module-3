// Feature 008 · Gestionar facturación (T011, T019, T025)
// ManageInvoicesService con el puerto de lectura en memoria.
import { ManageInvoicesService } from '../../../../src/application/services/billing/manage-invoices.service';
import { InvalidInvoiceQueryError } from '../../../../src/domain/errors/billing/invalid-invoice-query.error';
import { InvalidIssuedDateRangeError } from '../../../../src/domain/errors/billing/invalid-issued-date-range.error';
import { InvoiceNotFoundError } from '../../../../src/domain/errors/billing/invoice-not-found.error';
import { MissingSearchCriteriaError } from '../../../../src/domain/errors/billing/missing-search-criteria.error';
import { ManageInvoicesUseCase } from '../../../../src/domain/ports/in/billing/manage-invoices.use-case';
import {
  DB_NOW,
  directInvoice,
  InMemoryInvoiceQuery,
  otaInvoice,
} from '../../../support/billing/in-memory-invoice-query';

const ADMIN = 'f2d3b4a5-6c7d-4e8f-9012-3456789abcde';

describe('ManageInvoicesService', () => {
  let invoices: InMemoryInvoiceQuery;
  // Por el puerto de entrada, como lo llama el controller (con quién consulta).
  let service: ManageInvoicesUseCase;

  beforeEach(() => {
    invoices = new InMemoryInvoiceQuery();
    service = new ManageInvoicesService(invoices, 'America/Bogota');
  });

  describe('search — HU1', () => {
    it('devuelve las facturas del criterio con su número oficial y MATCHES', async () => {
      const own = otaInvoice({ invoiceNumber: 7 });
      invoices.invoices.push(own, directInvoice({ invoiceNumber: 8 }));

      const result = await service.search({ reservationRef: 'RES-000123' }, ADMIN);

      expect(result.items.map((item) => item.invoiceNumber)).toEqual([7]);
      expect(result.items[0].invoiceId).toBe(own.invoiceId);
      expect(result).toMatchObject({
        page: 1,
        pageSize: 20,
        totalItems: 1,
        totalPages: 1,
        resultStatus: 'MATCHES',
        customerMatchMode: null,
      });
    });

    it('sin coincidencias responde NO_MATCHES con la lista vacía, no un error (FR-008)', async () => {
      invoices.invoices.push(otaInvoice());

      const result = await service.search(
        { customerName: 'Nadie', customerMatch: 'PARTIAL' },
        ADMIN,
      );

      expect(result).toEqual({
        items: [],
        page: 1,
        pageSize: 20,
        totalItems: 0,
        totalPages: 0,
        asOf: DB_NOW,
        resultStatus: 'NO_MATCHES',
        customerMatchMode: 'PARTIAL',
      });
    });

    it('informa el modo de coincidencia aplicado al nombre', async () => {
      const result = await service.search({ customerName: 'Laura Gómez' }, ADMIN);
      expect(result.customerMatchMode).toBe('EXACT');
    });

    it('pagina sin omitir coincidencias: totalItems y totalPages cuentan todas (FR-007)', async () => {
      for (let n = 1; n <= 5; n++) {
        invoices.invoices.push(
          otaInvoice({ invoiceNumber: n, issuedAt: new Date(Date.UTC(2026, 11, n, 15)) }),
        );
      }

      const first = await service.search({ channel: 'OTA', pageSize: '2' }, ADMIN);
      const last = await service.search(
        { channel: 'OTA', pageSize: '2', page: '3', asOf: first.asOf.toISOString() },
        ADMIN,
      );

      expect(first.items.map((item) => item.invoiceNumber)).toEqual([5, 4]);
      expect(first).toMatchObject({ totalItems: 5, totalPages: 3, resultStatus: 'MATCHES' });
      expect(last.items.map((item) => item.invoiceNumber)).toEqual([1]);
    });

    it('una página más allá de la última sale vacía pero sigue informando las coincidencias', async () => {
      invoices.invoices.push(otaInvoice());
      const result = await service.search({ channel: 'OTA', page: '9' }, ADMIN);
      expect(result).toMatchObject({
        items: [],
        totalItems: 1,
        totalPages: 1,
        resultStatus: 'MATCHES',
      });
    });

    it('sin asOf lo fija con la hora de la base de datos y lo pasa al filtro (NFR-002)', async () => {
      const result = await service.search({ channel: 'DIRECT' }, ADMIN);

      expect(result.asOf).toEqual(DB_NOW);
      expect(invoices.searches[0].filter.asOf).toEqual(DB_NOW);
    });

    it('con asOf usa el recibido, para que las páginas siguientes no cambien', async () => {
      const asOf = '2026-12-30T10:00:00.000Z';
      const result = await service.search({ channel: 'DIRECT', asOf }, ADMIN);

      expect(result.asOf).toEqual(new Date(asOf));
      expect(invoices.searches[0].filter.asOf).toEqual(new Date(asOf));
    });

    it('las facturas emitidas después del asOf no aparecen', async () => {
      invoices.invoices.push(
        otaInvoice({ invoiceNumber: 1, issuedAt: new Date('2026-12-30T09:00:00.000Z') }),
        otaInvoice({ invoiceNumber: 2, issuedAt: new Date('2026-12-30T11:00:00.000Z') }),
      );

      const result = await service.search(
        { channel: 'OTA', asOf: '2026-12-30T10:00:00.000Z' },
        ADMIN,
      );

      expect(result.items.map((item) => item.invoiceNumber)).toEqual([1]);
    });

    it('asOf futuro respecto de la base de datos → INVALID_QUERY_PARAMS', async () => {
      await expect(
        service.search({ channel: 'OTA', asOf: '2027-01-01T00:00:00.000Z' }, ADMIN),
      ).rejects.toThrow(InvalidInvoiceQueryError);
      expect(invoices.searches).toHaveLength(0);
    });

    it('convierte el rango a Bogotá: [desde 00:00, hasta + 1 día 00:00) (NFR-006)', async () => {
      await service.search({ issuedFrom: '2026-12-01', issuedTo: '2026-12-31' }, ADMIN);

      expect(invoices.searches[0].filter.issued).toEqual({
        from: new Date('2026-12-01T05:00:00.000Z'),
        before: new Date('2027-01-01T05:00:00.000Z'),
      });
    });

    it('combina rango y canal: solo las de ese canal en ese rango (HU1 escenario 2)', async () => {
      invoices.invoices.push(
        otaInvoice({ invoiceNumber: 1, issuedAt: new Date('2026-12-10T15:00:00.000Z') }),
        otaInvoice({
          invoiceNumber: 2,
          otaId: 'expedia',
          issuedAt: new Date('2026-12-11T15:00:00.000Z'),
        }),
        directInvoice({ invoiceNumber: 3, issuedAt: new Date('2026-12-12T15:00:00.000Z') }),
        otaInvoice({ invoiceNumber: 4, issuedAt: new Date('2026-11-30T15:00:00.000Z') }),
      );

      const result = await service.search(
        { channel: 'OTA', otaId: 'booking', issuedFrom: '2026-12-01', issuedTo: '2026-12-31' },
        ADMIN,
      );

      expect(result.items.map((item) => item.invoiceNumber)).toEqual([1]);
    });

    it('rechaza sin consultar la base de datos: sin criterios, rango inválido o formato (FR-002, FR-013)', async () => {
      await expect(service.search({}, ADMIN)).rejects.toThrow(MissingSearchCriteriaError);
      await expect(
        service.search({ issuedFrom: '2026-12-31', issuedTo: '2026-12-01' }, ADMIN),
      ).rejects.toThrow(InvalidIssuedDateRangeError);
      await expect(service.search({ channel: 'OTA', pageSize: '101' }, ADMIN)).rejects.toThrow(
        InvalidInvoiceQueryError,
      );
      expect(invoices.calls).toBe(0);
    });
  });

  describe('getDetail — HU2', () => {
    it('devuelve la factura tal como se guardó, sin recalcular (FR-004, BR-004)', async () => {
      const invoice = otaInvoice();
      invoices.invoices.push(invoice);

      await expect(service.getDetail(invoice.invoiceId, ADMIN)).resolves.toEqual(invoice);
    });

    it('busca con el id en minúsculas', async () => {
      const invoice = otaInvoice();
      invoices.invoices.push(invoice);

      await expect(service.getDetail(invoice.invoiceId.toUpperCase(), ADMIN)).resolves.toEqual(
        invoice,
      );
    });

    it('id inexistente → INVOICE_NOT_FOUND', async () => {
      await expect(
        service.getDetail('7d1c2f0e-4b8a-4c51-9a3e-2f6b1d9c8e01', ADMIN),
      ).rejects.toThrow(InvoiceNotFoundError);
    });

    it('id que no es UUID → INVALID_QUERY_PARAMS sin consultar la base de datos', async () => {
      await expect(service.getDetail('1042', ADMIN)).rejects.toThrow(InvalidInvoiceQueryError);
      expect(invoices.calls).toBe(0);
    });
  });

  describe('summarizeByChannel — HU3', () => {
    it('agrupa por canal sin mezclar importes; DIRECT primero y las OTA por otaId (FR-012)', async () => {
      invoices.invoices.push(
        directInvoice({ issuedAt: new Date('2026-12-05T15:00:00.000Z') }),
        directInvoice({ issuedAt: new Date('2026-12-06T15:00:00.000Z') }),
        otaInvoice({ otaId: 'expedia', issuedAt: new Date('2026-12-07T15:00:00.000Z') }),
        otaInvoice({ otaId: 'booking', issuedAt: new Date('2026-12-08T15:00:00.000Z') }),
        otaInvoice({ otaId: 'booking', issuedAt: new Date('2026-12-09T15:00:00.000Z') }),
      );

      const summary = await service.summarizeByChannel(
        { issuedFrom: '2026-12-01', issuedTo: '2026-12-31' },
        ADMIN,
      );

      expect(summary).toEqual({
        range: { issuedFrom: '2026-12-01', issuedTo: '2026-12-31' },
        timezone: 'America/Bogota',
        currency: 'COP',
        channels: [
          {
            channel: 'DIRECT',
            otaId: null,
            invoiceCount: 2,
            totalLodging: '1080000.00',
            totalOtaCommission: '0.00',
            totalVat: '205200.00',
            totalInvoiced: '1285200.00',
          },
          {
            channel: 'OTA',
            otaId: 'booking',
            invoiceCount: 2,
            totalLodging: '1500000.00',
            totalOtaCommission: '225000.00',
            totalVat: '285000.00',
            totalInvoiced: '1785000.00',
          },
          {
            channel: 'OTA',
            otaId: 'expedia',
            invoiceCount: 1,
            totalLodging: '750000.00',
            totalOtaCommission: '112500.00',
            totalVat: '142500.00',
            totalInvoiced: '892500.00',
          },
        ],
      });
    });

    it('sin facturas en el rango: DIRECT y cada OTA histórica en cero, no un error (FR-014)', async () => {
      invoices.invoices.push(
        otaInvoice({ otaId: 'airbnb', issuedAt: new Date('2026-10-05T15:00:00.000Z') }),
      );

      const summary = await service.summarizeByChannel(
        { issuedFrom: '2026-12-01', issuedTo: '2026-12-31' },
        ADMIN,
      );

      const zero = {
        invoiceCount: 0,
        totalLodging: '0.00',
        totalOtaCommission: '0.00',
        totalVat: '0.00',
        totalInvoiced: '0.00',
      };
      expect(summary.channels).toEqual([
        { channel: 'DIRECT', otaId: null, ...zero },
        { channel: 'OTA', otaId: 'airbnb', ...zero },
      ]);
    });

    it('sin ninguna factura en el sistema: solo DIRECT en cero', async () => {
      const summary = await service.summarizeByChannel(
        { issuedFrom: '2026-12-01', issuedTo: '2026-12-31' },
        ADMIN,
      );
      expect(summary.channels).toEqual([
        expect.objectContaining({ channel: 'DIRECT', otaId: null, invoiceCount: 0 }),
      ]);
    });

    it('una OTA con facturas en el rango aparece aunque no esté en la lista de conocidas', async () => {
      invoices.invoices.push(
        otaInvoice({ otaId: 'nueva', issuedAt: new Date('2026-12-08T15:00:00.000Z') }),
      );
      invoices.listKnownOtaIds = async () => [];

      const summary = await service.summarizeByChannel(
        { issuedFrom: '2026-12-01', issuedTo: '2026-12-31' },
        ADMIN,
      );

      expect(summary.channels.map((channel) => channel.otaId)).toEqual([null, 'nueva']);
    });

    it('usa el intervalo en hora de Bogotá (NFR-006)', async () => {
      await service.summarizeByChannel({ issuedFrom: '2026-12-23', issuedTo: '2026-12-23' }, ADMIN);
      expect(invoices.intervals).toEqual([
        {
          from: new Date('2026-12-23T05:00:00.000Z'),
          before: new Date('2026-12-24T05:00:00.000Z'),
        },
      ]);
    });

    it('rango faltante o inválido → INVALID_DATE_RANGE sin resultado parcial (FR-013)', async () => {
      await expect(service.summarizeByChannel({}, ADMIN)).rejects.toThrow(
        InvalidIssuedDateRangeError,
      );
      await expect(
        service.summarizeByChannel({ issuedFrom: '2026-12-31', issuedTo: '2026-12-01' }, ADMIN),
      ).rejects.toThrow(InvalidIssuedDateRangeError);
      expect(invoices.calls).toBe(0);
    });
  });
});
