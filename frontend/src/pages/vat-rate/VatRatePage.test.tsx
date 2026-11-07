// Feature 001 · Actualizar porcentaje de IVA
// La pantalla completa (App + rutas + sesión) contra un backend simulado en fetch.
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CurrentVatRate, VatRateChange } from '../../api/vatRate';
import { App } from '../../App';
import { AuthProvider } from '../../auth/AuthContext';
import { saveSession } from '../../auth/session';
import { NBSP } from '../../lib/format';

const ADMIN_ID = 'f2d3b4a5-6c7d-4e8f-9012-3456789abcde';
const NEW_YEAR = '2026-01-01T05:00:00.000Z';

interface FakeBackend {
  current: CurrentVatRate | null;
  history: VatRateChange[];
  getStatus: number;
  putStatus: number;
  // Simula que otro Administrador guarda justo antes del siguiente GET.
  concurrentSave?: CurrentVatRate;
  puts: unknown[];
}

let backend: FakeBackend;

function json(status: number, body: unknown) {
  return Promise.resolve(new Response(JSON.stringify(body), { status }));
}

function apiError(status: number, errorCode: string) {
  return json(status, { errorCode, message: errorCode, timestamp: '', path: '/admin/vat-rate' });
}

function installFakeBackend() {
  vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
    const url = String(input);
    if (url !== '/api/admin/vat-rate') return apiError(404, 'NOT_FOUND');

    if ((init?.method ?? 'GET') === 'GET') {
      if (backend.getStatus !== 200) return apiError(backend.getStatus, 'FORBIDDEN');
      if (backend.concurrentSave) {
        backend.current = backend.concurrentSave;
        backend.concurrentSave = undefined;
      }
      return json(200, { current: backend.current, history: backend.history });
    }

    const body = JSON.parse(String(init?.body)) as { value: string };
    backend.puts.push(body);
    if (backend.putStatus === 401) return apiError(401, 'UNAUTHENTICATED');
    if (backend.putStatus !== 200) return apiError(backend.putStatus, 'UNEXPECTED_ERROR');
    const updatedAt = '2026-09-23T16:52:00.000Z';
    backend.history = [
      {
        valueBefore: backend.current?.value ?? null,
        valueAfter: body.value,
        changedBy: ADMIN_ID,
        changedByUsername: 'admin',
        changedAt: updatedAt,
      },
      ...backend.history,
    ];
    backend.current = {
      value: body.value,
      updatedBy: ADMIN_ID,
      updatedByUsername: 'admin',
      updatedAt,
    };
    return json(200, { value: body.value, updatedBy: ADMIN_ID, updatedAt });
  });
}

function renderScreen(role = 'Administrador') {
  saveSession({
    token: 'token-de-prueba',
    username: 'admin',
    userId: ADMIN_ID,
    role,
    expiresAt: Date.now() + 3_600_000,
  });
  return render(
    <MemoryRouter initialEntries={['/iva']}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </MemoryRouter>,
  );
}

function currentCard() {
  return screen.getByRole('region', { name: 'IVA vigente' });
}

beforeEach(() => {
  backend = {
    current: {
      value: '19.00',
      updatedBy: ADMIN_ID,
      updatedByUsername: 'admin',
      updatedAt: NEW_YEAR,
    },
    history: [
      {
        valueBefore: '16.00',
        valueAfter: '19.00',
        changedBy: ADMIN_ID,
        changedByUsername: 'admin',
        changedAt: NEW_YEAR,
      },
      {
        valueBefore: null,
        valueAfter: '16.00',
        changedBy: ADMIN_ID,
        changedByUsername: null,
        changedAt: '2024-07-15T14:30:00.000Z',
      },
    ],
    getStatus: 200,
    putStatus: 200,
    puts: [],
  };
  installFakeBackend();
});

describe('Pantalla Porcentaje de IVA (001)', () => {
  it('muestra el vigente, quién lo puso y el historial (FR-003, FR-005)', async () => {
    renderScreen();

    const card = await screen.findByRole('region', { name: 'IVA vigente' });
    expect(within(card).getByText(`19 %`)).toBeInTheDocument();
    expect(within(card).getByText('Único vigente')).toBeInTheDocument();
    expect(within(card).getByText('Desde el 01 ene 2026 · admin')).toBeInTheDocument();

    const rows = within(screen.getByRole('table')).getAllByRole('row').slice(1);
    expect(rows.map((row) => row.textContent)).toEqual([
      `01 ene 2026 · 00:0016${NBSP}%19${NBSP}%admin`,
      `15 jul 2024 · 09:30Inicial16${NBSP}%Usuario desconocido`,
    ]);
    expect(screen.getByText('Solo para facturas nuevas')).toBeInTheDocument();
  });

  it('estado 8: sin porcentaje configurado avisa que la facturación está bloqueada', async () => {
    backend.current = null;
    backend.history = [];
    renderScreen();

    expect(await screen.findByText('Configura un porcentaje de IVA')).toBeInTheDocument();
    expect(within(currentCard()).getByText('—')).toBeInTheDocument();
    expect(screen.getByText('Todavía no hay cambios registrados.')).toBeInTheDocument();
  });

  it('estado 9: un usuario sin rol Administrador ve que no tiene permiso', async () => {
    backend.getStatus = 403;
    renderScreen('OTA');

    expect(await screen.findByText('No tienes permiso')).toBeInTheDocument();
    expect(screen.getByText(/Tu rol es OTA/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Nuevo porcentaje')).not.toBeInTheDocument();
  });

  it('estado 2: un porcentaje inválido se rechaza sin llamar al backend y se conserva el vigente', async () => {
    const user = userEvent.setup();
    renderScreen();
    const input = await screen.findByLabelText('Nuevo porcentaje');

    await user.type(input, '-5');
    await user.click(screen.getByRole('button', { name: 'Guardar' }));

    expect(
      screen.getByText(`No puede ser negativo ni mayor a 100 %. Se conserva 19 %.`),
    ).toBeInTheDocument();
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(backend.puts).toEqual([]);
  });

  it('estado 6: el mismo valor no se envía', async () => {
    const user = userEvent.setup();
    renderScreen();

    await user.type(await screen.findByLabelText('Nuevo porcentaje'), '19');
    await user.click(screen.getByRole('button', { name: 'Guardar' }));

    expect(screen.getByText(`19 % ya es el vigente`)).toBeInTheDocument();
    expect(backend.puts).toEqual([]);
  });

  it('estado 1: guarda, actualiza el vigente y el historial, y lo confirma (HU1, NFR-003)', async () => {
    const user = userEvent.setup();
    renderScreen();

    await user.type(await screen.findByLabelText('Nuevo porcentaje'), '16,5');
    await user.click(screen.getByRole('button', { name: 'Guardar' }));

    expect(await screen.findByText(`IVA vigente: 16,5 %`)).toBeInTheDocument();
    expect(screen.getByText(`admin · 23 sep 2026, 11:52 · antes 19 %`)).toBeInTheDocument();
    expect(backend.puts).toEqual([{ value: '16.50' }]);
    expect(within(currentCard()).getByText(`16,5 %`)).toBeInTheDocument();
    expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(4);
    expect(screen.getByLabelText('Nuevo porcentaje')).toHaveValue('');
  });

  it('estado 5: si otro Administrador guardó, pide recargar en vez de pisar su cambio (FR-007)', async () => {
    const user = userEvent.setup();
    renderScreen();
    await user.type(await screen.findByLabelText('Nuevo porcentaje'), '16');
    backend.concurrentSave = {
      value: '18.00',
      updatedBy: 'otro',
      updatedByUsername: 'carlos',
      updatedAt: '2026-09-23T16:00:00.000Z',
    };

    await user.click(screen.getByRole('button', { name: 'Guardar' }));

    const dialog = await screen.findByRole('dialog', { name: 'El IVA cambió mientras editabas' });
    expect(
      within(dialog).getByText(`carlos guardó 18 %. Recarga antes de guardar.`),
    ).toBeInTheDocument();
    expect(backend.puts).toEqual([]);

    await user.click(within(dialog).getByRole('button', { name: 'Recargar' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(within(currentCard()).getByText(`18 %`)).toBeInTheDocument();
    expect(screen.getByLabelText('Nuevo porcentaje')).toHaveValue('16');
  });

  it('estado 7: si el backend no puede registrar el cambio, avisa y no cambia el vigente', async () => {
    const user = userEvent.setup();
    backend.putStatus = 422;
    renderScreen();

    await user.type(await screen.findByLabelText('Nuevo porcentaje'), '16');
    await user.click(screen.getByRole('button', { name: 'Guardar' }));

    expect(await screen.findByText('No se guardó el cambio')).toBeInTheDocument();
    expect(within(currentCard()).getByText(`19 %`)).toBeInTheDocument();
  });

  it('Cancelar limpia el campo y los avisos', async () => {
    const user = userEvent.setup();
    renderScreen();
    const input = await screen.findByLabelText('Nuevo porcentaje');

    await user.type(input, '200');
    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));

    expect(input).toHaveValue('');
    expect(screen.queryByText(/No puede ser negativo/)).not.toBeInTheDocument();
    expect(screen.getByText('Solo para facturas nuevas')).toBeInTheDocument();
  });

  it('con la sesión vencida (401) vuelve al login', async () => {
    const user = userEvent.setup();
    backend.putStatus = 401;
    renderScreen();

    await user.type(await screen.findByLabelText('Nuevo porcentaje'), '16');
    await user.click(screen.getByRole('button', { name: 'Guardar' }));

    expect(await screen.findByRole('heading', { name: 'Iniciar sesión' })).toBeInTheDocument();
  });
});
