// Feature 008 · La pantalla real frente a los tres contratos HTTP de consulta.
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../App';
import { AuthProvider } from '../../auth/AuthContext';
import { saveSession } from '../../auth/session';

const ADMIN_ID = 'f2d3b4a5-6c7d-4e8f-9012-3456789abcde';
const STAY_ID = 'c3a9e1b2-5f4d-4e6a-8b7c-1d2e3f4a5b6c';
const SETTLEMENT_ID = '4e2b8c1d-9a7f-4f3e-b6d5-0c1a2b3d4e5f';
const FIRST_ID = '7d1c2f0e-4b8a-4c51-9a3e-2f6b1d9c8e01';
const SECOND_ID = '7d1c2f0e-4b8a-4c51-9a3e-2f6b1d9c8e02';
const SNAPSHOT = '2026-11-09T15:00:00.000Z';

interface SearchItem {
  invoiceId: string;
  invoiceNumber: number;
  issuedAt: string;
  stayId: string;
  reservationRef: string;
  channel: 'DIRECT' | 'OTA';
  otaId: string | null;
  customerName: string;
  customerTaxId: string;
  currency: string;
  totalAmount: string;
}

interface Detail extends Omit<SearchItem, 'customerName' | 'customerTaxId'> {
  status: 'ISSUED';
  immutable: true;
  settlementId: string;
  customer: { name: string; taxId: string };
  lodgingAmount: string;
  otaCommissionAmount: string;
  netIncome: string;
  vatRateApplied: string;
  vatAmount: string;
}

interface RequestRecord { path: string; params: URLSearchParams; method: string }
interface FakeBackend {
  items: SearchItem[];
  details: Map<string, Detail>;
  requests: RequestRecord[];
  snapshot: string;
  status: number;
  listOffline: boolean;
  detailOffline: boolean;
  summaryOffline: boolean;
  detailStatus: number;
  delayedDetails: Map<string, Promise<Response>>;
}

let backend: FakeBackend;

function invoice(overrides: Partial<SearchItem> = {}): SearchItem {
  return {
    invoiceId: FIRST_ID,
    invoiceNumber: 1042,
    issuedAt: '2026-11-09T02:05:12.000Z',
    stayId: STAY_ID,
    reservationRef: 'RES-000123',
    channel: 'OTA',
    otaId: 'booking',
    customerName: 'Comercializadora Andina S.A.S.',
    customerTaxId: '900123456-7',
    currency: 'COP',
    totalAmount: '892500.01',
    ...overrides,
  };
}

function detail(item: SearchItem): Detail {
  const { customerName, customerTaxId, ...shared } = item;
  return {
    ...shared,
    status: 'ISSUED',
    immutable: true,
    settlementId: SETTLEMENT_ID,
    customer: { name: customerName, taxId: customerTaxId },
    lodgingAmount: '750000.01',
    otaCommissionAmount: item.channel === 'OTA' ? '112500.00' : '0.00',
    netIncome: item.channel === 'OTA' ? '637500.01' : '750000.01',
    vatRateApplied: '19.00',
    vatAmount: '142500.00',
  };
}

function response(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

function apiError(status: number, errorCode: string, message = errorCode): Response {
  return response(status, { errorCode, message, timestamp: SNAPSHOT, path: '/invoices' });
}

function matchingItems(params: URLSearchParams): SearchItem[] {
  const asOf = params.get('asOf') ?? backend.snapshot;
  return backend.items.filter((item) => {
    if (Date.parse(item.issuedAt) > Date.parse(asOf)) return false;
    for (const field of ['stayId', 'reservationRef', 'customerTaxId', 'channel', 'otaId'] as const) {
      if (params.has(field) && item[field] !== params.get(field)) return false;
    }
    if (params.has('customerName')) {
      const name = params.get('customerName')!.toLocaleLowerCase('es');
      const actual = item.customerName.toLocaleLowerCase('es');
      if (params.get('customerMatch') === 'PARTIAL' ? !actual.includes(name) : actual !== name) return false;
    }
    const from = params.get('issuedFrom');
    const to = params.get('issuedTo');
    if (from && Date.parse(item.issuedAt) < Date.parse(`${from}T00:00:00-05:00`)) return false;
    if (to && Date.parse(item.issuedAt) > Date.parse(`${to}T23:59:59.999-05:00`)) return false;
    return true;
  }).sort((left, right) => Date.parse(right.issuedAt) - Date.parse(left.issuedAt) || right.invoiceNumber - left.invoiceNumber);
}

function installFakeBackend() {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = new URL(String(input), 'http://localhost');
    backend.requests.push({ path: url.pathname, params: url.searchParams, method: init?.method ?? 'GET' });
    if (backend.status !== 200) {
      return apiError(backend.status, backend.status === 401 ? 'UNAUTHENTICATED' : 'FORBIDDEN');
    }
    if (url.pathname === '/api/invoices/summary') {
      if (backend.summaryOffline) throw new TypeError('Failed to fetch');
      return response(200, {
        range: { issuedFrom: url.searchParams.get('issuedFrom'), issuedTo: url.searchParams.get('issuedTo') },
        timezone: 'America/Bogota', currency: 'COP', channels: [
          { channel: 'DIRECT', otaId: null, invoiceCount: 2, totalLodging: '123000.10', totalOtaCommission: '0.00', totalVat: '23370.02', totalInvoiced: '146370.12' },
          { channel: 'OTA', otaId: 'airbnb', invoiceCount: 0, totalLodging: '0.00', totalOtaCommission: '0.00', totalVat: '0.00', totalInvoiced: '0.00' },
          { channel: 'OTA', otaId: 'booking', invoiceCount: 1, totalLodging: '750000.01', totalOtaCommission: '112500.00', totalVat: '142500.00', totalInvoiced: '892500.01' },
        ],
      });
    }
    if (url.pathname === '/api/invoices') {
      if (backend.listOffline) throw new TypeError('Failed to fetch');
      const all = matchingItems(url.searchParams);
      const page = Number(url.searchParams.get('page') ?? '1');
      const pageSize = Number(url.searchParams.get('pageSize') ?? '20');
      return response(200, {
        items: all.slice((page - 1) * pageSize, page * pageSize), page, pageSize,
        totalItems: all.length, totalPages: Math.ceil(all.length / pageSize),
        asOf: url.searchParams.get('asOf') ?? backend.snapshot,
        resultStatus: all.length ? 'MATCHES' : 'NO_MATCHES',
        customerMatchMode: url.searchParams.has('customerName') ? url.searchParams.get('customerMatch') ?? 'EXACT' : null,
      });
    }
    if (url.pathname.startsWith('/api/invoices/')) {
      const id = url.pathname.split('/').at(-1)!;
      const delayed = backend.delayedDetails.get(id);
      if (delayed) return delayed;
      if (backend.detailOffline) throw new TypeError('Failed to fetch');
      if (backend.detailStatus === 404 || !backend.details.has(id)) {
        return apiError(404, 'INVOICE_NOT_FOUND', 'La factura solicitada no existe.');
      }
      return response(200, backend.details.get(id));
    }
    return apiError(404, 'NOT_FOUND');
  });
}

function renderScreen(role = 'Administrador') {
  saveSession({ token: 'token-de-prueba', username: 'admin', userId: ADMIN_ID, role, expiresAt: Date.now() + 3_600_000 });
  return render(<MemoryRouter initialEntries={['/facturas']}><AuthProvider><App /></AuthProvider></MemoryRouter>);
}

function change(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

const results = () => screen.findByRole('table', { name: 'Facturas encontradas' });
const listRequests = () => backend.requests.filter((request) => request.path === '/api/invoices');

async function searchReservation(value = 'RES-000123') {
  change('Reserva', value);
  await userEvent.setup().click(screen.getByRole('button', { name: 'Buscar facturas' }));
}

async function searchChannel() {
  change('Canal', 'OTA');
  await userEvent.setup().click(screen.getByRole('button', { name: 'Buscar facturas' }));
  return results();
}

function manyInvoices() {
  backend.items = Array.from({ length: 25 }, (_, index) => invoice({
    invoiceId: `7d1c2f0e-4b8a-4c51-9a3e-${String(index + 1).padStart(12, '0')}`,
    invoiceNumber: 2000 + index,
    reservationRef: `RES-PAGINA-${index + 1}`,
    issuedAt: `2026-11-08T${String(index % 24).padStart(2, '0')}:00:00.000Z`,
  }));
}

beforeEach(() => {
  const first = invoice();
  const second = invoice({ invoiceId: SECOND_ID, invoiceNumber: 1043, reservationRef: 'RES-000124', customerName: 'Andina del Norte S.A.S.' });
  backend = {
    items: [first, second], details: new Map([[FIRST_ID, detail(first)], [SECOND_ID, detail(second)]]),
    requests: [], snapshot: SNAPSHOT, status: 200, listOffline: false, detailOffline: false,
    summaryOffline: false, detailStatus: 200, delayedDetails: new Map(),
  };
  installFakeBackend();
});

describe('Pantalla Facturas emitidas (008)', { timeout: 15000 }, () => {
  it('abre la ruta real sin consultar todo el histórico automáticamente', async () => {
    renderScreen();
    expect(screen.getByRole('heading', { name: 'Facturas emitidas' })).toBeInTheDocument();
    expect(screen.getByRole('form', { name: 'Buscar facturas' })).toBeInTheDocument();
    expect(screen.getByRole('form', { name: 'Consultar resumen por canal' })).toBeInTheDocument();
    await act(async () => { await Promise.resolve(); });
    expect(backend.requests).toEqual([]);
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('exige al menos un criterio antes de pedir la búsqueda', async () => {
    renderScreen();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Buscar facturas' }));
    expect(screen.getByRole('alert')).toHaveTextContent(/al menos.*criterio/i);
    expect(backend.requests).toEqual([]);
  });

  it('envía los filtros combinados, el modo de coincidencia y el JWT, y muestra el número oficial', async () => {
    renderScreen();
    change('Estancia (UUID)', STAY_ID);
    change('Reserva', 'RES-000123');
    change('Nombre del cliente', 'Comercializadora Andina S.A.S.');
    change('Documento fiscal', '900123456-7');
    change('Canal', 'OTA');
    change('Identificador OTA', 'booking');
    change('Emitidas desde', '2026-11-08');
    change('Emitidas hasta', '2026-11-08');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Buscar facturas' }));
    expect(await results()).toHaveTextContent('1042');
    expect(Object.fromEntries(listRequests()[0].params)).toMatchObject({
      stayId: STAY_ID, reservationRef: 'RES-000123', customerName: 'Comercializadora Andina S.A.S.',
      customerTaxId: '900123456-7', channel: 'OTA', otaId: 'booking',
      issuedFrom: '2026-11-08', issuedTo: '2026-11-08',
    });
    expect(listRequests()[0].params.get('customerMatch') ?? 'EXACT').toBe('EXACT');
    expect(listRequests()[0].params.get('page') ?? '1').toBe('1');
    expect(listRequests()[0].params.get('pageSize') ?? '20').toBe('20');
    expect(listRequests()[0].params.has('asOf')).toBe(false);
    expect(globalThis.fetch).toHaveBeenCalledWith(expect.stringContaining('/api/invoices?'), expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer token-de-prueba' }) }));
  });

  it('rechaza el nombre parcial de menos de tres caracteres y enfoca el campo inválido', async () => {
    renderScreen();
    change('Nombre del cliente', 'An');
    change('Coincidencia del nombre', 'PARTIAL');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Buscar facturas' }));
    expect(screen.getByLabelText('Nombre del cliente')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Nombre del cliente')).toHaveFocus();
    expect(backend.requests).toEqual([]);
  });

  it('rechaza un identificador de estancia inválido antes de consultar', async () => {
    renderScreen();
    change('Estancia (UUID)', 'no-es-un-uuid');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Buscar facturas' }));
    expect(screen.getByLabelText('Estancia (UUID)')).toHaveAttribute('aria-invalid', 'true');
    expect(backend.requests).toEqual([]);
  });

  it('exige ambas fechas de emisión y rechaza un rango invertido sin resultado parcial', async () => {
    renderScreen();
    const user = userEvent.setup();
    change('Emitidas desde', '2026-11-09');
    await user.click(screen.getByRole('button', { name: 'Buscar facturas' }));
    expect(screen.getByLabelText('Emitidas hasta')).toHaveAttribute('aria-invalid', 'true');
    change('Emitidas hasta', '2026-11-08');
    await user.click(screen.getByRole('button', { name: 'Buscar facturas' }));
    expect(screen.getByLabelText('Emitidas hasta')).toHaveAttribute('aria-invalid', 'true');
    expect(backend.requests).toEqual([]);
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('distingue la búsqueda parcial de clientes y mantiene cada factura separada', async () => {
    renderScreen();
    change('Nombre del cliente', 'Andina');
    change('Coincidencia del nombre', 'PARTIAL');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Buscar facturas' }));
    const table = await results();
    expect(within(table).getByRole('row', { name: /Comercializadora Andina/ })).toBeInTheDocument();
    expect(within(table).getByRole('row', { name: /Andina del Norte/ })).toBeInTheDocument();
    expect(listRequests()[0].params.get('customerMatch')).toBe('PARTIAL');
    expect(screen.getAllByText(/parcial/i).length).toBeGreaterThan(0);
  });

  it('informa explícitamente que una reserva no tiene facturas', async () => {
    renderScreen();
    await searchReservation('RES-CANCELADA');
    expect(await screen.findByText('No se encontraron facturas')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Ver factura/ })).not.toBeInTheDocument();
  });

  it('conserva los resultados aplicados mientras el usuario escribe otros filtros', async () => {
    renderScreen();
    await searchReservation();
    expect(await results()).toHaveTextContent('RES-000123');
    const count = listRequests().length;
    change('Reserva', 'RES-OTRO-BORRADOR');
    expect(await results()).toHaveTextContent('RES-000123');
    expect(listRequests()).toHaveLength(count);
  });

  it('reenvía el mismo asOf al paginar y excluye las nuevas facturas del recorrido', async () => {
    manyInvoices();
    renderScreen();
    const table = await searchChannel();
    const firstPageNumbers = within(table).getAllByRole('button', { name: /Ver factura/ }).map((button) => button.getAttribute('aria-label') ?? button.textContent);
    backend.items.push(invoice({ invoiceNumber: 9999, issuedAt: '2026-11-09T15:00:00.001Z', reservationRef: 'RES-NUEVA' }));
    await userEvent.setup().click(screen.getByRole('button', { name: 'Siguiente' }));
    await waitFor(() => expect(listRequests().at(-1)?.params.get('page')).toBe('2'));
    await waitFor(() => expect(within(screen.getByRole('table', { name: 'Facturas encontradas' })).getAllByRole('button', { name: /Ver factura/ })).toHaveLength(5));
    const secondPage = await results();
    expect(secondPage).not.toHaveTextContent('RES-NUEVA');
    expect(within(secondPage).getAllByRole('button', { name: /Ver factura/ }).every((button) => !firstPageNumbers.includes(button.getAttribute('aria-label') ?? button.textContent))).toBe(true);
    expect(listRequests().at(-1)?.params.get('asOf')).toBe(SNAPSHOT);
    expect(screen.getByRole('button', { name: 'Siguiente' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Anterior' })).toBeEnabled();
  });

  it('una nueva búsqueda comienza en la primera página sin reutilizar el asOf anterior', async () => {
    manyInvoices();
    renderScreen();
    await searchChannel();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Siguiente' }));
    await waitFor(() => expect(listRequests().at(-1)?.params.get('page')).toBe('2'));
    backend.snapshot = '2026-11-09T16:00:00.000Z';
    change('Reserva', 'RES-PAGINA-1');
    await user.click(screen.getByRole('button', { name: 'Buscar facturas' }));
    await waitFor(() => expect(listRequests().at(-1)?.params.get('reservationRef')).toBe('RES-PAGINA-1'));
    expect(listRequests().at(-1)?.params.get('page') ?? '1').toBe('1');
    expect(listRequests().at(-1)?.params.has('asOf')).toBe(false);
    expect(await results()).toHaveTextContent('RES-PAGINA-1');
  });

  it('cambiar el tamaño vuelve a la primera página usando los criterios aplicados', async () => {
    manyInvoices();
    renderScreen();
    await searchChannel();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Siguiente' }));
    await waitFor(() => expect(listRequests().at(-1)?.params.get('page')).toBe('2'));
    change('Reserva', 'RES-NO-APLICADA');
    change('Facturas por página', '50');
    await waitFor(() => expect(listRequests().at(-1)?.params.get('pageSize')).toBe('50'));
    expect(listRequests().at(-1)?.params.get('page') ?? '1').toBe('1');
    expect(listRequests().at(-1)?.params.has('reservationRef')).toBe(false);
    expect(listRequests().at(-1)?.params.has('asOf')).toBe(false);
    await waitFor(() => expect(within(screen.getByRole('table', { name: 'Facturas encontradas' })).getAllByRole('button', { name: /Ver factura/ })).toHaveLength(25));
  });

  it('abre el desglose persistido y su trazabilidad en modo de solo lectura y hora de Colombia', async () => {
    renderScreen();
    await searchReservation();
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Ver factura 1042' }));
    const dialog = screen.getByRole('dialog', { name: 'Detalle de factura' });
    await waitFor(() => expect(dialog).toHaveTextContent(SETTLEMENT_ID));
    expect(dialog).toHaveTextContent('Comercializadora Andina S.A.S.');
    expect(dialog).toHaveTextContent('900123456-7');
    expect(dialog).toHaveTextContent('750.000,01');
    expect(dialog).toHaveTextContent('112.500,00');
    expect(dialog).toHaveTextContent('637.500,01');
    expect(dialog).toHaveTextContent('142.500,00');
    expect(dialog).toHaveTextContent('892.500,01');
    expect(dialog).toHaveTextContent(/08 nov 2026.*21:05/);
    expect(dialog).toHaveTextContent(/Inmutable.*Solo lectura/i);
    expect(within(dialog).queryByRole('button', { name: /editar|guardar|anular|reemitir/i })).not.toBeInTheDocument();
    expect(backend.requests.every((request) => request.method === 'GET')).toBe(true);
  });

  it('muestra centavos exactos incluso en importes superiores al entero seguro de JavaScript', async () => {
    backend.items[0].totalAmount = '9007199254740993.01';
    renderScreen();
    await searchReservation();
    expect(await results()).toHaveTextContent('9.007.199.254.740.993,01');
  });

  it('una factura inexistente informa el 404 sin borrar los resultados de búsqueda', async () => {
    backend.detailStatus = 404;
    renderScreen();
    await searchReservation();
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Ver factura 1042' }));
    const dialog = screen.getByRole('dialog', { name: 'Detalle de factura' });
    expect(await within(dialog).findByText(/La factura solicitada no existe/)).toBeInTheDocument();
    expect(await results()).toHaveTextContent('RES-000123');
    expect(within(dialog).queryByText(SETTLEMENT_ID)).not.toBeInTheDocument();
  });

  it('permite reintentar el detalle después de recuperar la conexión', async () => {
    backend.detailOffline = true;
    renderScreen();
    await searchReservation();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Ver factura 1042' }));
    const dialog = screen.getByRole('dialog', { name: 'Detalle de factura' });
    const retry = await within(dialog).findByRole('button', { name: 'Reintentar detalle' });
    backend.detailOffline = false;
    await user.click(retry);
    await waitFor(() => expect(dialog).toHaveTextContent(SETTLEMENT_ID));
  });

  it('consulta el resumen independiente y mantiene canales sin facturas con importes cero', async () => {
    renderScreen();
    change('Resumen desde', '2026-11-01');
    change('Resumen hasta', '2026-11-30');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Consultar resumen' }));
    const table = await screen.findByRole('table', { name: 'Resumen por canal' });
    const zeroRow = within(table).getByRole('row', { name: /airbnb/i });
    expect(zeroRow).toHaveTextContent('0,00');
    expect(within(table).getByRole('row', { name: /booking/i })).toHaveTextContent('892.500,01');
    expect(within(table).getByRole('row', { name: /directo/i })).toHaveTextContent('146.370,12');
    expect(screen.getAllByText(/America\/Bogota/).length).toBeGreaterThan(0);
    expect(listRequests()).toEqual([]);
    const request = backend.requests.find((entry) => entry.path === '/api/invoices/summary');
    expect(Object.fromEntries(request!.params)).toEqual({ issuedFrom: '2026-11-01', issuedTo: '2026-11-30' });
  });

  it('exige el rango completo y ordenado antes de solicitar un resumen', async () => {
    renderScreen();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Consultar resumen' }));
    expect(screen.getByLabelText('Resumen desde')).toHaveAttribute('aria-invalid', 'true');
    change('Resumen desde', '2026-11-30');
    change('Resumen hasta', '2026-11-01');
    await user.click(screen.getByRole('button', { name: 'Consultar resumen' }));
    expect(screen.getByLabelText('Resumen hasta')).toHaveAttribute('aria-invalid', 'true');
    expect(backend.requests).toEqual([]);
  });

  it('reintenta un resumen fallido con el rango que se había enviado', async () => {
    backend.summaryOffline = true;
    renderScreen();
    const user = userEvent.setup();
    change('Resumen desde', '2026-11-01');
    change('Resumen hasta', '2026-11-30');
    await user.click(screen.getByRole('button', { name: 'Consultar resumen' }));
    const retry = await screen.findByRole('button', { name: 'Reintentar resumen' });
    backend.summaryOffline = false;
    change('Resumen desde', '2026-12-01');
    await user.click(retry);
    expect(await screen.findByRole('table', { name: 'Resumen por canal' })).toHaveTextContent('booking');
    expect(backend.requests.at(-1)?.params.get('issuedFrom')).toBe('2026-11-01');
  });

  it('reintenta una búsqueda fallida conservando sus filtros originales', async () => {
    backend.listOffline = true;
    renderScreen();
    await searchReservation();
    const retry = await screen.findByRole('button', { name: 'Reintentar búsqueda' });
    backend.listOffline = false;
    change('Reserva', 'RES-EDITADA-SIN-BUSCAR');
    await userEvent.setup().click(retry);
    expect(await results()).toHaveTextContent('RES-000123');
    expect(listRequests().at(-1)?.params.get('reservationRef')).toBe('RES-000123');
  });

  it('cierra la sesión si el backend responde 401', async () => {
    backend.status = 401;
    renderScreen();
    await searchReservation();
    expect(await screen.findByRole('heading', { name: 'Iniciar sesión' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Buscar facturas' })).not.toBeInTheDocument();
  });

  it('un usuario OTA no recibe controles administrativos ni provoca consultas', () => {
    renderScreen('OTA');
    expect(screen.getByText('No tienes permiso')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Buscar facturas' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Consultar resumen' })).not.toBeInTheDocument();
    expect(backend.requests).toEqual([]);
  });

  it('retira los controles y los resultados si el administrador pierde permisos durante una consulta', async () => {
    renderScreen();
    await searchReservation();
    expect(await results()).toBeInTheDocument();
    backend.status = 403;
    change('Reserva', 'RES-000124');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Buscar facturas' }));
    expect(await screen.findByText('No tienes permiso')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Buscar facturas' })).not.toBeInTheDocument();
  });

  it('ignora el detalle tardío de una factura cerrada cuando ya se abrió otra', async () => {
    let releaseFirst!: (response: Response) => void;
    backend.delayedDetails.set(FIRST_ID, new Promise<Response>((resolve) => { releaseFirst = resolve; }));
    renderScreen();
    await searchChannel();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Ver factura 1042' }));
    await user.click(screen.getByRole('button', { name: 'Cerrar detalle' }));
    await user.click(screen.getByRole('button', { name: 'Ver factura 1043' }));
    const dialog = screen.getByRole('dialog', { name: 'Detalle de factura' });
    await waitFor(() => expect(dialog).toHaveTextContent('RES-000124'));
    await act(async () => { releaseFirst(response(200, backend.details.get(FIRST_ID))); await Promise.resolve(); });
    expect(dialog).toHaveTextContent('RES-000124');
    expect(dialog).not.toHaveTextContent('RES-000123');
  });
});
