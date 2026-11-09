// Feature 011 · La ruta real y su publicación frente al contrato HTTP simulado.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CalendarEntry, CalendarEntryInput, SeasonCalendar } from '../../api/seasonCalendar';
import type { SeasonRule } from '../../api/seasonRules';
import { App } from '../../App';
import { AuthProvider } from '../../auth/AuthContext';
import { saveSession } from '../../auth/session';

const YEAR = Number(new Intl.DateTimeFormat('en', { year: 'numeric', timeZone: 'America/Bogota' }).format(new Date()));
const ADMIN_ID = 'f2d3b4a5-6c7d-4e8f-9012-3456789abcde';
const REGULAR_ID = '00000000-0000-4000-8000-000000000001';
const HIGH_ID = '5dca644e-7a6a-4d2e-a9a5-1943188c4710';
const EVENT_ID = '5dca644e-7a6a-4d2e-a9a5-1943188c4711';
const BASE_ID = 'e6cfa8ed-8b7f-4cb4-bbf8-0678180d1f91';
const EXCEPTION_ID = '27c4d2a6-f4ec-42db-b143-8c817bdb8e98';
const INHERITED_ID = '7995b0b5-14b6-4d37-9827-40246f45e1c2';
const INSTANT = `${YEAR}-11-09T15:00:00.000Z`;
const date = (suffix: string) => `${YEAR}-${suffix}`;

interface FakeBackend {
  calendar: SeasonCalendar;
  seasons: SeasonRule[];
  queries: URLSearchParams[];
  writes: Array<{ year: number; body: { expectedRevision: number | null; entries: CalendarEntryInput[] } }>;
  offline: boolean;
  getStatus: number;
  writeError?: { status: number; errorCode: string; message: string };
}

let backend: FakeBackend;

function season(seasonId: string, name: string, color: string, adjustmentPercent: string): SeasonRule {
  return { seasonId, name, color, adjustmentPercent, isDefault: seasonId === REGULAR_ID, version: 1, validFrom: INSTANT, updatedAt: INSTANT, updatedBy: ADMIN_ID };
}

function json(status: number, body: unknown) {
  return Promise.resolve(new Response(JSON.stringify(body), { status }));
}

function apiError(status: number, errorCode: string, message = errorCode) {
  return json(status, { errorCode, message, timestamp: INSTANT, path: '/admin/season-calendar' });
}

function ownInput(entry: CalendarEntry): CalendarEntryInput {
  return { entryId: entry.entryId, seasonId: entry.season.seasonId, kind: entry.kind, startDate: entry.startDate, endDate: entry.endDate };
}

function installFakeBackend() {
  vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
    const url = new URL(String(input), 'http://localhost');
    const method = init?.method ?? 'GET';
    if (method === 'GET') {
      if (url.pathname === '/api/admin/season-calendar') backend.queries.push(url.searchParams);
      if (backend.offline) return Promise.reject(new TypeError('Failed to fetch'));
      if (backend.getStatus !== 200) {
        return apiError(backend.getStatus, backend.getStatus === 401 ? 'UNAUTHENTICATED' : 'FORBIDDEN');
      }
      if (url.pathname === '/api/admin/season-rules') return json(200, { asOf: INSTANT, seasons: backend.seasons });
      if (url.pathname === '/api/admin/season-calendar') {
        if (url.searchParams.get('revision') === '999') {
          return apiError(404, 'SEASON_CALENDAR_NOT_FOUND', 'La revisión solicitada no existe.');
        }
        return json(200, {
          ...backend.calendar,
          revision: url.searchParams.has('revision') ? Number(url.searchParams.get('revision')) : backend.calendar.revision,
          asOf: url.searchParams.get('asOf') ?? INSTANT,
        });
      }
    }
    if (method === 'PUT' && url.pathname.startsWith('/api/admin/season-calendar/')) {
      const body = JSON.parse(String(init?.body)) as FakeBackend['writes'][number]['body'];
      backend.writes.push({ year: Number(url.pathname.split('/').at(-1)), body });
      if (backend.writeError) {
        const { status, errorCode, message } = backend.writeError;
        return apiError(status, errorCode, message);
      }
      if ((body.expectedRevision ?? 0) !== backend.calendar.revision) {
        return apiError(409, 'SEASON_CALENDAR_CONFLICT', 'Otro Administrador publicó una revisión nueva.');
      }
      backend.calendar = {
        ...backend.calendar,
        revision: backend.calendar.revision + 1,
        effectiveAt: INSTANT,
        changedAt: INSTANT,
        changedBy: ADMIN_ID,
        entries: body.entries.map((entry, index) => ({
          entryId: entry.entryId ?? `00000000-0000-4000-8000-${String(index + 100).padStart(12, '0')}`,
          kind: entry.kind,
          startDate: entry.startDate,
          endDate: entry.endDate,
          season: backend.seasons.find((item) => item.seasonId === entry.seasonId)!,
        })),
        carriedInEntries: backend.calendar.carriedInEntries.map((entry) => ({
          ...entry,
          season: backend.seasons.find((item) => item.seasonId === entry.season.seasonId)!,
        })),
      };
      return json(200, backend.calendar);
    }
    return apiError(404, 'NOT_FOUND');
  });
}

function renderScreen(role = 'Administrador') {
  saveSession({ token: 'token-de-prueba', username: 'admin', userId: ADMIN_ID, role, expiresAt: Date.now() + 3_600_000 });
  return render(<MemoryRouter initialEntries={['/calendario']}><AuthProvider><App /></AuthProvider></MemoryRouter>);
}

const assignments = () => screen.findByRole('table', { name: 'Períodos y excepciones del año' });

async function addEntry(startDate: string, endDate: string, kind: 'BASE' | 'EXCEPTION' = 'BASE') {
  const user = userEvent.setup();
  await user.selectOptions(screen.getByLabelText('Temporada'), kind === 'BASE' ? HIGH_ID : EVENT_ID);
  await user.selectOptions(screen.getByLabelText('Tipo de asignación'), kind);
  fireEvent.change(screen.getByLabelText('Fecha de inicio'), { target: { value: startDate } });
  if (kind === 'BASE') fireEvent.change(screen.getByLabelText('Fecha de fin'), { target: { value: endDate } });
  await user.click(screen.getByRole('button', { name: 'Agregar asignación' }));
  return user;
}

async function publish() {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Publicar calendario' }));
  const dialog = screen.getByRole('dialog', { name: 'Publicar calendario' });
  await user.click(within(dialog).getByRole('button', { name: 'Confirmar publicación' }));
  await waitFor(() => expect(backend.writes.length).toBeGreaterThan(0));
}

beforeEach(() => {
  const seasons = [season(REGULAR_ID, 'Regular', '#808080', '-2.50'), season(HIGH_ID, 'Alta', '#C0392B', '25.00'), season(EVENT_ID, 'Evento', '#8E44AD', '50.00')];
  backend = {
    seasons,
    calendar: {
      year: YEAR, asOf: INSTANT, revision: 2, effectiveAt: INSTANT, changedAt: INSTANT, changedBy: ADMIN_ID,
      defaultSeason: seasons[0],
      entries: [
        { entryId: BASE_ID, kind: 'BASE', startDate: date('06-01'), endDate: date('08-31'), season: seasons[1] },
        { entryId: EXCEPTION_ID, kind: 'EXCEPTION', startDate: date('07-04'), endDate: date('07-04'), season: seasons[2] },
      ],
      carriedInEntries: [{ entryId: INHERITED_ID, ownerYear: YEAR - 1, ownerRevision: 3, kind: 'BASE', startDate: `${YEAR - 1}-12-20`, endDate: date('01-10'), season: seasons[1] }],
      unclassifiedRanges: [{ from: date('01-11'), to: date('05-31'), resolvedAs: 'DEFAULT' }, { from: date('09-01'), to: date('12-31'), resolvedAs: 'DEFAULT' }],
      conflicts: [],
    },
    queries: [], writes: [], offline: false, getStatus: 200,
  };
  installFakeBackend();
});

describe('Pantalla Calendario de temporadas (011)', { timeout: 15000 }, () => {
  it('abre la ruta real, distingue excepción, base heredada y default, y permite recorrer días con teclado', async () => {
    const user = userEvent.setup();
    const { container } = renderScreen();
    expect(await assignments()).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Calendario de temporadas' })).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Leyenda del calendario' })).getByText('Regular')).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Períodos heredados del año anterior' })).toHaveTextContent(`Calendario ${YEAR - 1}`);

    const exception = container.querySelector<HTMLButtonElement>(`button[data-date="${date('07-04')}"]`)!;
    const inherited = container.querySelector<HTMLButtonElement>(`button[data-date="${date('01-02')}"]`)!;
    const defaultDay = container.querySelector<HTMLButtonElement>(`button[data-date="${date('09-01')}"]`)!;
    expect(exception).toHaveAttribute('data-source', 'EXCEPTION');
    expect(exception).toHaveAccessibleName(/Evento.*50\s%/);
    expect(inherited).toHaveAccessibleName(/heredado.*Alta/);
    expect(defaultDay).toHaveAttribute('data-source', 'DEFAULT');
    await user.click(exception);
    expect(exception).toHaveAttribute('aria-pressed', 'true');
    await user.keyboard('{ArrowRight}');
    expect(container.querySelector(`button[data-date="${date('07-05')}"]`)).toHaveFocus();
    expect(globalThis.fetch).toHaveBeenCalledWith(expect.stringContaining('/api/admin/season-calendar?year='), expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer token-de-prueba' }) }));
  });

  it('publica todo el año desde una ventana: conserva entradas fuera del rango y excluye heredados y metadatos', async () => {
    const user = userEvent.setup();
    renderScreen();
    await assignments();
    fireEvent.change(screen.getByLabelText('Desde'), { target: { value: date('06-01') } });
    fireEvent.change(screen.getByLabelText('Hasta'), { target: { value: date('07-31') } });
    await user.click(screen.getByRole('button', { name: 'Consultar calendario' }));
    await waitFor(() => expect(backend.queries.at(-1)?.get('from')).toBe(date('06-01')));
    await assignments();
    const originals = backend.calendar.entries.map(ownInput);
    await addEntry(date('12-20'), `${YEAR + 1}-01-10`);
    await addEntry(date('09-01'), date('09-01'), 'EXCEPTION');
    await publish();

    expect(backend.writes).toEqual([{ year: YEAR, body: {
      expectedRevision: 2,
      entries: [...originals,
        { seasonId: HIGH_ID, kind: 'BASE', startDate: date('12-20'), endDate: `${YEAR + 1}-01-10` },
        { seasonId: EVENT_ID, kind: 'EXCEPTION', startDate: date('09-01'), endDate: date('09-01') },
      ],
    } }]);
    expect(backend.calendar.revision).toBe(3);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  }, 15000);

  it('permite corregir un solape en el borrador y bloquea su publicación', async () => {
    renderScreen();
    await assignments();
    const user = await addEntry(date('06-15'), date('06-20'));
    expect(screen.getAllByText(/se solapan/).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Publicar calendario' })).toBeDisabled();
    expect(backend.writes).toEqual([]);
    await user.click(screen.getByRole('button', { name: `Quitar período ${date('06-15')}` }));
    expect(screen.queryByText(/Los períodos .* se solapan/)).not.toBeInTheDocument();
  });

  it('señala las excepciones duplicadas sin publicar ni escoger una de ellas', async () => {
    const { container } = renderScreen();
    await assignments();
    await addEntry(date('07-04'), date('07-04'), 'EXCEPTION');
    expect(screen.getAllByText(/dos excepciones/).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Publicar calendario' })).toBeDisabled();
    expect(container.querySelector(`button[data-date="${date('07-04')}"]`)).toHaveAttribute('data-source', 'CONFLICT');
    expect(backend.writes).toEqual([]);
  });

  it('guarda una edición conservando su identidad y la revisión esperada', async () => {
    const user = userEvent.setup();
    renderScreen();
    await user.click(await screen.findByRole('button', { name: `Editar período ${date('06-01')}` }));
    fireEvent.change(screen.getByLabelText('Fecha de fin'), { target: { value: date('08-30') } });
    await user.click(screen.getByRole('button', { name: 'Guardar asignación' }));
    await publish();
    expect(backend.writes[0].body.expectedRevision).toBe(2);
    expect(backend.writes[0].body.entries).toContainEqual({ entryId: BASE_ID, seasonId: HIGH_ID, kind: 'BASE', startDate: date('06-01'), endDate: date('08-30') });
  });

  it('quitar la última asignación solo cambia el borrador hasta confirmar una publicación vacía', async () => {
    backend.calendar.entries = [backend.calendar.entries[0]];
    const user = userEvent.setup();
    renderScreen();
    await user.click(await screen.findByRole('button', { name: `Quitar período ${date('06-01')}` }));
    expect(backend.writes).toEqual([]);
    expect(backend.calendar.entries).toHaveLength(1);
    expect(await assignments()).toHaveTextContent('No hay asignaciones propias');
    await publish();
    expect(backend.writes).toEqual([{ year: YEAR, body: { expectedRevision: 2, entries: [] } }]);
    expect(backend.calendar.carriedInEntries).toHaveLength(1);
  });

  it('crea la primera revisión vacía explícita con expectedRevision null', async () => {
    backend.calendar = { ...backend.calendar, revision: 0, entries: [], effectiveAt: null, changedAt: null, changedBy: null };
    renderScreen();
    await assignments();
    expect(screen.getByText('Sin publicación propia', { exact: false })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Publicar calendario' })).toBeEnabled();
    await publish();

    expect(backend.writes).toEqual([{ year: YEAR, body: { expectedRevision: null, entries: [] } }]);
    expect(backend.calendar.revision).toBe(1);
    expect(backend.calendar.carriedInEntries).toHaveLength(1);
    expect(await screen.findByText('Calendario publicado · Revisión 1')).toBeInTheDocument();
  });

  it('consulta una revisión histórica con los datos de su snapshot y sin controles de escritura', async () => {
    const user = userEvent.setup();
    renderScreen();
    await assignments();
    // La revisión sigue mostrando una temporada que ya no está en el catálogo vigente.
    backend.seasons = backend.seasons.filter((entry) => entry.seasonId !== EVENT_ID);
    await user.selectOptions(screen.getByLabelText('Consulta'), 'revision');
    fireEvent.change(screen.getByLabelText('Revisión'), { target: { value: '1' } });
    await user.click(screen.getByRole('button', { name: 'Consultar calendario' }));
    await waitFor(() => expect(backend.queries.at(-1)?.get('revision')).toBe('1'));
    await assignments();
    expect(backend.queries.at(-1)?.has('asOf')).toBe(false);
    expect(within(await assignments()).getByRole('row', { name: /Evento/ })).toBeInTheDocument();
    expect(screen.queryByLabelText('Temporada')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Publicar calendario' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Editar período/ })).not.toBeInTheDocument();
  });

  it('interpreta asOf en hora de Colombia y lo envía en UTC sin mezclarlo con revisión', async () => {
    const user = userEvent.setup();
    renderScreen();
    await assignments();
    await user.selectOptions(screen.getByLabelText('Consulta'), 'asOf');
    // En 1993 America/Bogota tenía otro desplazamiento histórico; el filtro
    // anunciado como UTC−05:00 debe conservar exactamente ese desplazamiento.
    fireEvent.change(screen.getByLabelText('Fecha y hora (Colombia)'), { target: { value: '1993-01-01T17:30' } });
    await user.click(screen.getByRole('button', { name: 'Consultar calendario' }));
    await waitFor(() => expect(backend.queries.at(-1)?.get('asOf')).toBe('1993-01-01T22:30:00.000Z'));
    await assignments();
    expect(backend.queries.at(-1)?.has('revision')).toBe(false);
    expect((screen.getByLabelText('Fecha y hora (Colombia)') as HTMLInputElement).value).toMatch(/^1993-01-01T17:30/);
    expect(screen.queryByLabelText('Temporada')).not.toBeInTheDocument();
    expect(backend.writes).toEqual([]);
  });

  it('rechaza rangos invertidos antes de consultar y conserva el calendario cargado', async () => {
    const user = userEvent.setup();
    renderScreen();
    await assignments();
    const requests = backend.queries.length;
    fireEvent.change(screen.getByLabelText('Desde'), { target: { value: date('08-31') } });
    fireEvent.change(screen.getByLabelText('Hasta'), { target: { value: date('06-01') } });
    await user.click(screen.getByRole('button', { name: 'Consultar calendario' }));
    expect(screen.getByLabelText('Hasta')).toHaveAttribute('aria-invalid', 'true');
    expect(backend.queries).toHaveLength(requests);
    expect(await assignments()).toHaveTextContent('Alta');
  });

  it('conserva el borrador ante una revisión concurrente y exige recarga explícita para volver a publicar', async () => {
    renderScreen();
    await assignments();
    const user = await addEntry(date('12-20'), `${YEAR + 1}-01-10`);
    backend.calendar.revision = 3;
    await publish();
    expect(await screen.findByText('El calendario cambió mientras editabas')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: `Quitar período ${date('12-20')}` })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Publicar calendario' })).toBeDisabled();
    expect(backend.writes[0].body.expectedRevision).toBe(2);
    await user.click(screen.getByRole('button', { name: 'Recargar calendario' }));
    const discard = screen.getByRole('dialog', { name: 'Descartar cambios' });
    await user.click(within(discard).getByRole('button', { name: 'Descartar y continuar' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: `Quitar período ${date('12-20')}` })).not.toBeInTheDocument());
    expect(backend.writes).toHaveLength(1);
  }, 15000);

  it('un fallo de publicación conserva el borrador y permite reintentar con la misma revisión', async () => {
    backend.writeError = { status: 422, errorCode: 'UNEXPECTED_ERROR', message: 'No fue posible registrar el calendario.' };
    renderScreen();
    await assignments();
    await addEntry(date('12-20'), `${YEAR + 1}-01-10`);
    await publish();
    expect(await screen.findByText('No fue posible registrar el calendario.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: `Quitar período ${date('12-20')}` })).toBeInTheDocument();
    expect(backend.calendar.revision).toBe(2);
    backend.writeError = undefined;
    await publish();
    await waitFor(() => expect(backend.writes).toHaveLength(2));
    expect(backend.writes[1].body).toEqual(backend.writes[0].body);
    expect(backend.calendar.revision).toBe(3);
  }, 15000);

  it('pide confirmar antes de cambiar de consulta y permite conservar el borrador al cancelar', async () => {
    renderScreen();
    await assignments();
    const user = await addEntry(date('12-20'), `${YEAR + 1}-01-10`);
    const requests = backend.queries.length;
    await user.click(screen.getByRole('button', { name: 'Consultar calendario' }));
    const discard = screen.getByRole('dialog', { name: 'Descartar cambios' });
    await user.click(within(discard).getByRole('button', { name: /Cancelar|Seguir editando|Conservar/ }));
    expect(screen.getByRole('button', { name: `Quitar período ${date('12-20')}` })).toBeInTheDocument();
    expect(backend.queries).toHaveLength(requests);
    expect(backend.writes).toEqual([]);
  });

  it('mantiene el aviso de revisión concurrente al editar, quitar y descartar cambios locales', async () => {
    renderScreen();
    await assignments();
    const user = await addEntry(date('12-20'), `${YEAR + 1}-01-10`);
    backend.calendar.revision = 3;
    await publish();
    expect(await screen.findByText('El calendario cambió mientras editabas')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: `Editar período ${date('06-01')}` }));
    fireEvent.change(screen.getByLabelText('Fecha de fin'), { target: { value: date('08-30') } });
    await user.click(screen.getByRole('button', { name: 'Guardar asignación' }));
    expect(screen.getByText('El calendario cambió mientras editabas')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Recargar calendario' })).toBeEnabled();

    await user.click(screen.getByRole('button', { name: `Quitar período ${date('12-20')}` }));
    expect(screen.getByText('El calendario cambió mientras editabas')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Recargar calendario' })).toBeEnabled();

    await user.click(screen.getByRole('button', { name: 'Descartar cambios' }));
    await user.click(within(screen.getByRole('dialog', { name: 'Descartar cambios' })).getByRole('button', { name: 'Descartar y continuar' }));
    expect(screen.getByText('El calendario cambió mientras editabas')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Recargar calendario' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Publicar calendario' })).toBeDisabled();
    expect(backend.writes).toHaveLength(1);
  });

  it('limpia una asignación parcial conservando las demás del borrador y habilita publicar', async () => {
    renderScreen();
    await assignments();
    const user = await addEntry(date('12-20'), `${YEAR + 1}-01-10`);
    fireEvent.change(screen.getByLabelText('Fecha de inicio'), { target: { value: date('03-01') } });
    expect(screen.getByRole('button', { name: 'Publicar calendario' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Limpiar asignación' }));

    expect(screen.getByLabelText('Fecha de inicio')).toHaveValue('');
    expect(screen.getByLabelText('Fecha de fin')).toHaveValue('');
    expect(screen.getByRole('button', { name: `Quitar período ${date('12-20')}` })).toBeInTheDocument();
    expect(within(await assignments()).getAllByRole('row')).toHaveLength(4);
    expect(screen.getByRole('button', { name: 'Publicar calendario' })).toBeEnabled();
    expect(backend.writes).toEqual([]);
  });

  it('confirma el descarte del formulario al editar otra fila y conserva el borrador agregado', async () => {
    renderScreen();
    await assignments();
    const user = await addEntry(date('12-20'), `${YEAR + 1}-01-10`);
    await user.click(screen.getByRole('button', { name: `Editar período ${date('06-01')}` }));
    fireEvent.change(screen.getByLabelText('Fecha de fin'), { target: { value: date('08-30') } });
    await user.click(screen.getByRole('button', { name: `Editar excepción ${date('07-04')}` }));
    let discard = screen.getByRole('dialog', { name: 'Descartar cambios' });
    expect(screen.getByLabelText('Fecha de fin')).toHaveValue(date('08-30'));
    await user.click(within(discard).getByRole('button', { name: 'Seguir editando' }));
    expect(screen.getByLabelText('Fecha de fin')).toHaveValue(date('08-30'));

    await user.click(screen.getByRole('button', { name: `Editar excepción ${date('07-04')}` }));
    discard = screen.getByRole('dialog', { name: 'Descartar cambios' });
    await user.click(within(discard).getByRole('button', { name: 'Descartar y continuar' }));
    expect(screen.getByLabelText('Fecha de inicio')).toHaveValue(date('07-04'));
    expect(screen.getByLabelText('Fecha de fin')).toHaveValue(date('07-04'));
    expect(screen.getByLabelText('Tipo de asignación')).toHaveValue('EXCEPTION');
    expect(screen.getByRole('button', { name: `Quitar período ${date('12-20')}` })).toBeInTheDocument();
    expect(within(await assignments()).getByRole('row', { name: /Alta.*01 jun/ })).toHaveTextContent(`31 ago ${YEAR}`);
    expect(backend.writes).toEqual([]);
  });

  it('conserva el ajuste actualizado por el servidor al volver a construir una vista previa', async () => {
    const { container } = renderScreen();
    await assignments();
    await addEntry(date('12-20'), `${YEAR + 1}-01-10`);
    backend.seasons = backend.seasons.map((entry) => entry.seasonId === HIGH_ID ? { ...entry, adjustmentPercent: '50.00' } : entry);
    await publish();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    let highDay = container.querySelector<HTMLButtonElement>(`button[data-date="${date('06-02')}"]`)!;
    expect(highDay).toHaveAccessibleName(/Alta.*50\s%/);

    await addEntry(date('11-01'), date('11-10'));
    highDay = container.querySelector<HTMLButtonElement>(`button[data-date="${date('06-02')}"]`)!;
    expect(highDay).toHaveAccessibleName(/Alta.*50\s%/);
    expect(highDay).not.toHaveAccessibleName(/25\s%/);
    const newHighDay = container.querySelector<HTMLButtonElement>(`button[data-date="${date('11-02')}"]`)!;
    expect(newHighDay).toHaveAccessibleName(/Alta.*50\s%/);
    const highRows = within(await assignments()).getAllByRole('row', { name: /Alta/ });
    expect(highRows).toHaveLength(3);
    for (const row of highRows) expect(row).toHaveTextContent('50 %');
  });

  it('una revisión histórica inexistente muestra el error completo sin dejar resultados parciales', async () => {
    const user = userEvent.setup();
    renderScreen();
    await assignments();
    await user.selectOptions(screen.getByLabelText('Consulta'), 'revision');
    fireEvent.change(screen.getByLabelText('Revisión'), { target: { value: '999' } });
    await user.click(screen.getByRole('button', { name: 'Consultar calendario' }));
    expect(await screen.findByText('La revisión solicitada no existe.')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Temporada')).not.toBeInTheDocument();
    expect(backend.queries.at(-1)?.get('revision')).toBe('999');
    expect(backend.writes).toEqual([]);

    await user.selectOptions(screen.getByLabelText('Consulta'), 'current');
    await user.click(screen.getByRole('button', { name: 'Consultar calendario' }));
    expect(await assignments()).toBeInTheDocument();
    expect(backend.queries.at(-1)?.has('revision')).toBe(false);
  });

  it('permite reintentar una carga fallida cuando vuelve la conexión', async () => {
    backend.offline = true;
    const user = userEvent.setup();
    renderScreen();
    const retry = await screen.findByRole('button', { name: 'Reintentar' });
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    backend.offline = false;
    await user.click(retry);
    expect(await assignments()).toBeInTheDocument();
  });

  it('vuelve al login cuando el token ha expirado', async () => {
    backend.getStatus = 401;
    renderScreen();
    expect(await screen.findByRole('heading', { name: 'Iniciar sesión' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Temporada')).not.toBeInTheDocument();
  });

  it('un rol sin permiso no recibe el calendario ni controles de edición', async () => {
    backend.getStatus = 403;
    renderScreen('OTA');
    expect(await screen.findByText('No tienes permiso')).toBeInTheDocument();
    expect(screen.queryByLabelText('Temporada')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Publicar calendario' })).not.toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(backend.writes).toEqual([]);
  });
});
