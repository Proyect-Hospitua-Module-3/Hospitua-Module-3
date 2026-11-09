// Feature 009 · Modificar precio tarifa según temporada
// La pantalla y sus rutas reales frente al contrato HTTP de un backend simulado.
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SeasonRule } from '../../api/seasonRules';
import { App } from '../../App';
import { AuthProvider } from '../../auth/AuthContext';
import { saveSession } from '../../auth/session';

const ADMIN_ID = 'f2d3b4a5-6c7d-4e8f-9012-3456789abcde';
const REGULAR_ID = '00000000-0000-4000-8000-000000000001';
const FESTIVAL_ID = '5dca644e-7a6a-4d2e-a9a5-1943188c4710';
const CREATED_ID = '5dca644e-7a6a-4d2e-a9a5-1943188c4711';
const UPDATED_AT = '2026-10-09T20:12:00.000Z';

interface WriteRequest {
  method: string;
  seasonId?: string;
  body: Record<string, unknown> | undefined;
}

interface FakeBackend {
  seasons: SeasonRule[];
  getStatus: number;
  getOffline: boolean;
  writeError?: { status: number; errorCode: string; message: string };
  writes: WriteRequest[];
}

let backend: FakeBackend;

function season(overrides: Partial<SeasonRule>): SeasonRule {
  return {
    seasonId: FESTIVAL_ID,
    name: 'Festival',
    color: '#C0392B',
    adjustmentPercent: '25.00',
    isDefault: false,
    version: 1,
    validFrom: UPDATED_AT,
    updatedBy: ADMIN_ID,
    updatedAt: UPDATED_AT,
    ...overrides,
  };
}

function json(status: number, body: unknown) {
  return Promise.resolve(new Response(JSON.stringify(body), { status }));
}

function apiError(status: number, errorCode: string, message = errorCode) {
  return json(status, { errorCode, message, timestamp: UPDATED_AT, path: '/admin/season-rules' });
}

function installFakeBackend() {
  vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
    const url = String(input);
    const base = '/api/admin/season-rules';
    if (url !== base && !url.startsWith(`${base}/`)) return apiError(404, 'NOT_FOUND');
    const method = init?.method ?? 'GET';

    if (method === 'GET') {
      if (backend.getOffline) return Promise.reject(new TypeError('Failed to fetch'));
      if (backend.getStatus !== 200) {
        return apiError(
          backend.getStatus,
          backend.getStatus === 401 ? 'UNAUTHENTICATED' : 'FORBIDDEN',
        );
      }
      return json(200, { asOf: UPDATED_AT, seasons: backend.seasons });
    }

    const seasonId = url === base ? undefined : url.slice(base.length + 1);
    const body = init?.body
      ? (JSON.parse(String(init.body)) as Record<string, unknown>)
      : undefined;
    backend.writes.push({ method, seasonId, body });
    if (backend.writeError) {
      const { status, errorCode, message } = backend.writeError;
      return apiError(status, errorCode, message);
    }

    if (method === 'POST' && body) {
      const saved = season({
        seasonId: CREATED_ID,
        name: String(body.name),
        color: String(body.color),
        adjustmentPercent: String(body.adjustmentPercent),
      });
      backend.seasons.push(saved);
      return json(201, saved);
    }

    const previous = backend.seasons.find((item) => item.seasonId === seasonId);
    if (!previous) return apiError(404, 'SEASON_NOT_FOUND', 'La temporada ya no está disponible.');

    if (method === 'PUT' && body) {
      if (body.expectedVersion !== previous.version) {
        return apiError(409, 'SEASON_RULE_CONFLICT', 'Otro Administrador modificó esta temporada.');
      }
      const saved = {
        ...previous,
        name: body.name === undefined ? previous.name : String(body.name),
        color: body.color === undefined ? previous.color : String(body.color),
        adjustmentPercent:
          body.adjustmentPercent === undefined
            ? previous.adjustmentPercent
            : String(body.adjustmentPercent),
        version: previous.version + 1,
      };
      backend.seasons = backend.seasons.map((item) => (item.seasonId === seasonId ? saved : item));
      return json(200, saved);
    }

    if (method === 'DELETE') {
      backend.seasons = backend.seasons.filter((item) => item.seasonId !== seasonId);
      return Promise.resolve(new Response(null, { status: 204 }));
    }

    return apiError(400, 'INVALID_REQUEST');
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
    <MemoryRouter initialEntries={['/temporadas']}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </MemoryRouter>,
  );
}

async function catalog() {
  return screen.findByRole('table', { name: 'Catálogo de temporadas' });
}

async function fillNewSeason(name = 'Baja', adjustment = '-10,5', color = '#4a8b7c') {
  const user = userEvent.setup();
  const nameInput = await screen.findByLabelText('Nombre');
  const colorInput = screen.getByLabelText('Color hexadecimal');
  const adjustmentInput = screen.getByLabelText('Ajuste porcentual');
  await user.clear(nameInput);
  await user.type(nameInput, name);
  await user.clear(colorInput);
  await user.type(colorInput, color);
  await user.clear(adjustmentInput);
  await user.type(adjustmentInput, adjustment);
  return user;
}

beforeEach(() => {
  backend = {
    seasons: [
      season({
        seasonId: REGULAR_ID,
        name: 'Regular',
        color: '#808080',
        adjustmentPercent: '-2.50',
        isDefault: true,
        version: 2,
      }),
      season({}),
    ],
    getStatus: 200,
    getOffline: false,
    writes: [],
  };
  installFakeBackend();
});

describe('Pantalla Temporadas y tarifas (009)', () => {
  it('muestra el catálogo con ajustes exactos e identifica Regular como predeterminada', async () => {
    renderScreen();
    const table = await catalog();
    const regularRow = within(table).getByRole('row', { name: /Regular/ });
    const festivalRow = within(table).getByRole('row', { name: /Festival/ });

    expect(within(regularRow).getByText('Predeterminada')).toBeInTheDocument();
    expect(regularRow).toHaveTextContent('-2,5 %');
    expect(festivalRow).toHaveTextContent('25 %');
    expect(festivalRow).toHaveTextContent('#C0392B');
    expect(screen.getByRole('heading', { name: 'Temporadas y tarifas' })).toBeInTheDocument();
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/admin/season-rules',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer token-de-prueba' }),
      }),
    );
  });

  it('crea una temporada normalizando nombre, color y ajuste firmado sin cambiar las demás', async () => {
    renderScreen();
    const user = await fillNewSeason('  Baja  ');
    await user.click(screen.getByRole('button', { name: 'Guardar' }));

    expect(await screen.findByText('Baja: temporada creada')).toBeInTheDocument();
    expect(backend.writes).toEqual([
      {
        method: 'POST',
        seasonId: undefined,
        body: { name: 'Baja', color: '#4A8B7C', adjustmentPercent: '-10.50' },
      },
    ]);
    const table = await catalog();
    expect(within(table).getByRole('row', { name: /Baja/ })).toHaveTextContent('-10,5 %');
    expect(within(table).getByRole('row', { name: /Festival/ })).toHaveTextContent('25 %');
  });

  it('rechaza un ajuste inválido antes de escribir y conserva el catálogo vigente', async () => {
    renderScreen();
    const user = await fillNewSeason('Baja', '-100,01');
    await user.click(screen.getByRole('button', { name: 'Guardar' }));

    expect(screen.getByLabelText('Ajuste porcentual')).toHaveAttribute('aria-invalid', 'true');
    expect(backend.writes).toEqual([]);
    expect(within(await catalog()).getAllByRole('row')).toHaveLength(3);
  });

  it('edita una temporada enviando la versión que se cargó', async () => {
    const user = userEvent.setup();
    renderScreen();
    await user.click(await screen.findByRole('button', { name: 'Editar Festival' }));
    const input = screen.getByLabelText('Ajuste porcentual');
    await user.clear(input);
    await user.type(input, '30,5');
    await user.click(screen.getByRole('button', { name: 'Guardar' }));

    expect(await screen.findByText('Festival: cambios guardados')).toBeInTheDocument();
    expect(backend.writes).toEqual([
      {
        method: 'PUT',
        seasonId: FESTIVAL_ID,
        body: {
          name: 'Festival',
          color: '#C0392B',
          adjustmentPercent: '30.50',
          expectedVersion: 1,
        },
      },
    ]);
    expect(within(await catalog()).getByRole('row', { name: /Festival/ })).toHaveTextContent(
      '30,5 %',
    );
    expect(backend.seasons.find((item) => item.seasonId === REGULAR_ID)?.adjustmentPercent).toBe(
      '-2.50',
    );
  });

  it('protege el nombre y el retiro de Regular, y permite cambiar su ajuste y su color', async () => {
    const user = userEvent.setup();
    renderScreen();
    await user.click(await screen.findByRole('button', { name: 'Editar Regular' }));

    expect(screen.getByLabelText('Nombre')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Retirar Regular' })).not.toBeInTheDocument();
    const colorInput = screen.getByLabelText('Color hexadecimal');
    const adjustmentInput = screen.getByLabelText('Ajuste porcentual');
    expect(colorInput).toBeEnabled();
    expect(adjustmentInput).toBeEnabled();
    await user.clear(colorInput);
    await user.type(colorInput, '#123abc');
    await user.clear(adjustmentInput);
    await user.type(adjustmentInput, '5');
    await user.click(screen.getByRole('button', { name: 'Guardar' }));

    expect(await screen.findByText('Regular: cambios guardados')).toBeInTheDocument();
    expect(backend.writes[0]).toMatchObject({
      method: 'PUT',
      seasonId: REGULAR_ID,
      body: { name: 'Regular', color: '#123ABC', adjustmentPercent: '5.00', expectedVersion: 2 },
    });
  });

  it('acepta guardar los mismos valores sin generar una escritura redundante', async () => {
    const user = userEvent.setup();
    renderScreen();
    await user.click(await screen.findByRole('button', { name: 'Editar Festival' }));
    await user.click(screen.getByRole('button', { name: 'Guardar' }));

    expect(await screen.findByText('No hay cambios por guardar')).toBeInTheDocument();
    expect(backend.writes).toEqual([]);
  });

  it('Cancelar descarta la edición sin modificar la temporada', async () => {
    const user = userEvent.setup();
    renderScreen();
    await user.click(await screen.findByRole('button', { name: 'Editar Festival' }));
    await user.clear(screen.getByLabelText('Nombre'));
    await user.type(screen.getByLabelText('Nombre'), 'Otro nombre');
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));

    expect(screen.getByLabelText('Nombre')).toHaveValue('');
    expect(within(await catalog()).getByRole('row', { name: /Festival/ })).toBeInTheDocument();
    expect(backend.writes).toEqual([]);
  });

  it('un nombre en conflicto se señala en el formulario conservando lo escrito', async () => {
    backend.writeError = {
      status: 409,
      errorCode: 'SEASON_NAME_CONFLICT',
      message: 'Ya existe una temporada con ese nombre.',
    };
    renderScreen();
    const user = await fillNewSeason('Festival');
    await user.click(screen.getByRole('button', { name: 'Guardar' }));

    await waitFor(() =>
      expect(screen.getByLabelText('Nombre')).toHaveAttribute('aria-invalid', 'true'),
    );
    expect(screen.getByLabelText('Nombre')).toHaveValue('Festival');
    expect(backend.seasons).toHaveLength(2);
  });

  it('el retiro requiere confirmación y Cancelar no envía DELETE', async () => {
    const user = userEvent.setup();
    renderScreen();
    await user.click(await screen.findByRole('button', { name: 'Retirar Festival' }));
    const dialog = screen.getByRole('dialog', { name: 'Retirar temporada' });
    expect(dialog).toHaveTextContent('Festival');
    await user.click(within(dialog).getByRole('button', { name: 'Cancelar' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(backend.writes).toEqual([]);
    expect(within(await catalog()).getByRole('row', { name: /Festival/ })).toBeInTheDocument();
  });

  it('el modal mantiene el foco al navegar con teclado y lo devuelve al cerrar con Escape', async () => {
    const user = userEvent.setup();
    renderScreen();
    const trigger = await screen.findByRole('button', { name: 'Retirar Festival' });
    await user.click(trigger);

    const dialog = screen.getByRole('dialog', { name: 'Retirar temporada' });
    const cancel = within(dialog).getByRole('button', { name: 'Cancelar' });
    const confirm = within(dialog).getByRole('button', { name: 'Retirar temporada' });
    expect(cancel).toHaveFocus();

    await user.tab();
    expect(confirm).toHaveFocus();
    await user.tab();
    expect(cancel).toHaveFocus();
    await user.tab({ shift: true });
    expect(confirm).toHaveFocus();
    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(backend.writes).toEqual([]);
  });

  it('retira la temporada tras confirmar y procesa correctamente la respuesta vacía 204', async () => {
    const user = userEvent.setup();
    renderScreen();
    await user.click(await screen.findByRole('button', { name: 'Retirar Festival' }));
    const dialog = screen.getByRole('dialog', { name: 'Retirar temporada' });
    await user.click(within(dialog).getByRole('button', { name: 'Retirar temporada' }));

    expect(await screen.findByText('Festival: temporada retirada')).toBeInTheDocument();
    expect(backend.writes).toEqual([{ method: 'DELETE', seasonId: FESTIVAL_ID, body: undefined }]);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(
      within(await catalog()).queryByRole('row', { name: /Festival/ }),
    ).not.toBeInTheDocument();
    expect(within(await catalog()).getByRole('row', { name: /Regular/ })).toBeInTheDocument();
  });

  it('si está asignada al calendario, el retiro muestra el conflicto y conserva la temporada', async () => {
    backend.writeError = {
      status: 409,
      errorCode: 'SEASON_IN_USE',
      message: 'Primero retira la temporada del calendario vigente.',
    };
    const user = userEvent.setup();
    renderScreen();
    await user.click(await screen.findByRole('button', { name: 'Retirar Festival' }));
    await user.click(
      within(screen.getByRole('dialog', { name: 'Retirar temporada' })).getByRole('button', {
        name: 'Retirar temporada',
      }),
    );

    await waitFor(() => expect(backend.writes).toHaveLength(1));
    expect(screen.getByRole('dialog', { name: 'Retirar temporada' })).toBeInTheDocument();
    expect(within(await catalog()).getByRole('row', { name: /Festival/ })).toBeInTheDocument();
    expect(backend.seasons).toHaveLength(2);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Retirar temporada' })).toBeEnabled(),
    );
    expect(
      within(screen.getByRole('dialog', { name: 'Retirar temporada' })).getByRole('alert'),
    ).toHaveTextContent(/calendario/i);
  });

  it('rechaza una edición obsoleta y permite recargar la versión actual antes de reintentar', async () => {
    const user = userEvent.setup();
    renderScreen();
    await user.click(await screen.findByRole('button', { name: 'Editar Festival' }));
    const input = screen.getByLabelText('Ajuste porcentual');
    await user.clear(input);
    await user.type(input, '30');
    backend.seasons = backend.seasons.map((item) =>
      item.seasonId === FESTIVAL_ID ? { ...item, version: 2, adjustmentPercent: '40.00' } : item,
    );
    await user.click(screen.getByRole('button', { name: 'Guardar' }));

    expect(await screen.findByText('La temporada cambió mientras editabas')).toBeInTheDocument();
    expect(backend.writes).toHaveLength(1);
    expect(backend.writes[0].body?.expectedVersion).toBe(1);
    await user.click(screen.getByRole('button', { name: 'Recargar temporada' }));

    await waitFor(() =>
      expect(
        Number(
          screen.getByLabelText<HTMLInputElement>('Ajuste porcentual').value.replace(',', '.'),
        ),
      ).toBe(40),
    );
    expect(backend.writes).toHaveLength(1);
    await user.clear(screen.getByLabelText('Ajuste porcentual'));
    await user.type(screen.getByLabelText('Ajuste porcentual'), '35');
    await user.click(screen.getByRole('button', { name: 'Guardar' }));

    expect(await screen.findByText('Festival: cambios guardados')).toBeInTheDocument();
    expect(backend.writes[1].body?.expectedVersion).toBe(2);
  });

  it('si falla la recarga del conflicto, conserva el modal y el borrador hasta poder reintentar', async () => {
    const user = userEvent.setup();
    renderScreen();
    await user.click(await screen.findByRole('button', { name: 'Editar Festival' }));
    await user.clear(screen.getByLabelText('Ajuste porcentual'));
    await user.type(screen.getByLabelText('Ajuste porcentual'), '30');
    backend.seasons = backend.seasons.map((item) =>
      item.seasonId === FESTIVAL_ID ? { ...item, version: 2, adjustmentPercent: '40.00' } : item,
    );
    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    const dialog = await screen.findByRole('dialog', {
      name: 'La temporada cambió mientras editabas',
    });

    backend.getOffline = true;
    await user.click(within(dialog).getByRole('button', { name: 'Recargar temporada' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'No se pudo recargar la temporada',
    );
    expect(screen.getByLabelText('Ajuste porcentual')).toHaveValue('30');
    expect(screen.getByLabelText('Nombre')).toHaveValue('Festival');
    expect(backend.writes).toHaveLength(1);

    backend.getOffline = false;
    await user.click(within(dialog).getByRole('button', { name: 'Recargar temporada' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByLabelText('Ajuste porcentual')).toHaveValue('40.00');
    expect(backend.writes).toHaveLength(1);
  });

  it('recargar tras el retiro externo de otra temporada conserva el borrador que se estaba editando', async () => {
    backend.seasons.push(
      season({ seasonId: CREATED_ID, name: 'Baja', adjustmentPercent: '-10.00' }),
    );
    const user = userEvent.setup();
    renderScreen();
    await user.click(await screen.findByRole('button', { name: 'Editar Festival' }));
    await user.clear(screen.getByLabelText('Ajuste porcentual'));
    await user.type(screen.getByLabelText('Ajuste porcentual'), '30');
    await user.click(screen.getByRole('button', { name: 'Retirar Baja' }));
    backend.seasons = backend.seasons.filter((item) => item.seasonId !== CREATED_ID);
    await user.click(
      within(screen.getByRole('dialog', { name: 'Retirar temporada' })).getByRole('button', {
        name: 'Retirar temporada',
      }),
    );

    await user.click(await screen.findByRole('button', { name: 'Actualizar catálogo' }));

    await waitFor(() =>
      expect(
        within(screen.getByRole('table')).queryByRole('row', { name: /Baja/ }),
      ).not.toBeInTheDocument(),
    );
    expect(screen.getByRole('region', { name: 'Editar temporada' })).toBeInTheDocument();
    expect(screen.getByLabelText('Nombre')).toHaveValue('Festival');
    expect(screen.getByLabelText('Ajuste porcentual')).toHaveValue('30');
    expect(screen.getByRole('button', { name: 'Guardar' })).toBeEnabled();
    expect(backend.writes).toEqual([{ method: 'DELETE', seasonId: CREATED_ID, body: undefined }]);
  });

  it('recargar tras la retirada externa de la temporada editada cierra su editor', async () => {
    const user = userEvent.setup();
    renderScreen();
    await user.click(await screen.findByRole('button', { name: 'Editar Festival' }));
    await user.clear(screen.getByLabelText('Ajuste porcentual'));
    await user.type(screen.getByLabelText('Ajuste porcentual'), '30');
    backend.seasons = backend.seasons.filter((item) => item.seasonId !== FESTIVAL_ID);
    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    await user.click(await screen.findByRole('button', { name: 'Actualizar catálogo' }));

    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Editar temporada' })).not.toBeInTheDocument(),
    );
    expect(screen.getByRole('region', { name: 'Nueva temporada' })).toBeInTheDocument();
    expect(screen.getByLabelText('Nombre')).toHaveValue('');
    expect(
      within(await catalog()).queryByRole('row', { name: /Festival/ }),
    ).not.toBeInTheDocument();
    expect(backend.writes).toHaveLength(1);
  });

  it('un fallo de escritura permite corregir o reintentar conservando los campos', async () => {
    backend.writeError = {
      status: 422,
      errorCode: 'UNEXPECTED_ERROR',
      message: 'No fue posible registrar el cambio.',
    };
    renderScreen();
    const user = await fillNewSeason('Baja');
    await user.click(screen.getByRole('button', { name: 'Guardar' }));

    await waitFor(() => expect(backend.writes).toHaveLength(1));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Guardar' })).toBeEnabled());
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByLabelText('Nombre')).toHaveValue('Baja');
    expect(screen.getByLabelText('Ajuste porcentual')).toHaveValue('-10,5');
    expect(backend.seasons).toHaveLength(2);
  });

  it('permite reintentar la carga cuando se recupera la conexión', async () => {
    backend.getOffline = true;
    const user = userEvent.setup();
    renderScreen();

    const retry = await screen.findByRole('button', { name: 'Reintentar' });
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    backend.getOffline = false;
    await user.click(retry);

    expect(await catalog()).toBeInTheDocument();
  });

  it('un usuario sin permisos no recibe controles de edición', async () => {
    backend.getStatus = 403;
    renderScreen('OTA');

    expect(await screen.findByText('No tienes permiso')).toBeInTheDocument();
    expect(screen.queryByLabelText('Nombre')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Guardar' })).not.toBeInTheDocument();
  });

  it('si pierde permisos durante una escritura, informa la restricción y quita los controles', async () => {
    backend.writeError = {
      status: 403,
      errorCode: 'FORBIDDEN',
      message: 'Tu rol no tiene permiso para esta operación.',
    };
    renderScreen();
    const user = await fillNewSeason('Baja');
    await user.click(screen.getByRole('button', { name: 'Guardar' }));

    expect(await screen.findByText('No tienes permiso')).toBeInTheDocument();
    expect(screen.queryByLabelText('Nombre')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Guardar' })).not.toBeInTheDocument();
    expect(backend.writes).toHaveLength(1);
    expect(backend.seasons).toHaveLength(2);
  });

  it('si expira la sesión durante una escritura, vuelve al login', async () => {
    backend.writeError = {
      status: 401,
      errorCode: 'UNAUTHENTICATED',
      message: 'El token ha expirado.',
    };
    renderScreen();
    const user = await fillNewSeason('Baja');
    await user.click(screen.getByRole('button', { name: 'Guardar' }));

    expect(await screen.findByRole('heading', { name: 'Iniciar sesión' })).toBeInTheDocument();
  });
});
