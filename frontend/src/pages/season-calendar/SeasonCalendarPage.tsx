// Feature 011 · Revisar temporada del año
import { useEffect, useMemo, useRef, useState } from 'react';
import { ApiError } from '../../api/http';
import {
  CalendarEntryInput,
  CalendarQuery,
  CalendarSeason,
  getSeasonCalendar,
  publishSeasonCalendar,
  SeasonCalendar,
} from '../../api/seasonCalendar';
import { getSeasonRules } from '../../api/seasonRules';
import { useAuth } from '../../auth/AuthContext';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Modal } from '../../components/ui/Modal';
import { Notice, NoticeVariant } from '../../components/ui/Notice';
import { formatDateTime, formatPercent, HOTEL_TIME_ZONE } from '../../lib/format';
import {
  calendarDefaultRanges,
  calendarEntriesToDraft,
  CalendarEntryErrors,
  CalendarQueryErrors,
  CalendarQueryInput,
  calendarYearBounds,
  draftCalendarEntries,
  formatCalendarDate,
  parseCalendarQuery,
  resolveCalendarDate,
  validateCalendarDraft,
  validateCalendarEntry,
} from '../../lib/seasonCalendar';
import { CalendarEntriesTable } from './CalendarEntriesTable';
import { CalendarEntryForm } from './CalendarEntryForm';
import { CalendarLegend } from './CalendarLegend';
import { CalendarQueryForm } from './CalendarQueryForm';
import { YearCalendar } from './YearCalendar';
import styles from './SeasonCalendarPage.module.css';

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; calendar: SeasonCalendar; seasons: CalendarSeason[]; query: CalendarQuery }
  | { kind: 'error'; message: string }
  | { kind: 'forbidden' };

interface CalendarNotice {
  variant: NoticeVariant;
  title: string;
  description?: string;
}

type PendingAction = { kind: 'load'; query: CalendarQuery } | { kind: 'reset' } | { kind: 'edit'; entryId: string };

function initialQuery(): CalendarQueryInput {
  return {
    year: new Intl.DateTimeFormat('en-US', { timeZone: HOTEL_TIME_ZONE, year: 'numeric' }).format(new Date()),
    from: '', to: '', mode: 'current', revision: '', asOf: '',
  };
}

function emptyEntry(seasons: readonly CalendarSeason[]): CalendarEntryInput {
  return { seasonId: seasons[0]?.seasonId ?? '', kind: 'BASE', startDate: '', endDate: '' };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'No fue posible completar la operación. Reintenta.';
}

function colombiaDateTimeInput(instant: string): string {
  // El filtro usa UTC−05:00 fijo, igual que parseCalendarQuery, incluso para
  // instantes anteriores a los cambios históricos de zona horaria de Colombia.
  return new Date(Date.parse(instant) - 5 * 60 * 60 * 1000).toISOString().slice(0, 19);
}

export function SeasonCalendarPage() {
  const { session, logout } = useAuth();
  const token = session?.token ?? '';
  const [queryValues, setQueryValues] = useState(initialQuery);
  const [queryErrors, setQueryErrors] = useState<CalendarQueryErrors>({});
  const [request, setRequest] = useState(() => ({ query: { year: Number(queryValues.year) } as CalendarQuery }));
  const [load, setLoad] = useState<LoadState>({ kind: 'loading' });
  const [draft, setDraft] = useState<CalendarEntryInput[]>([]);
  const [values, setValues] = useState<CalendarEntryInput>(() => emptyEntry([]));
  const [entryErrors, setEntryErrors] = useState<CalendarEntryErrors>({});
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [formTouched, setFormTouched] = useState(false);
  const [selectedDate, setSelectedDate] = useState('');
  const [notice, setNotice] = useState<CalendarNotice | null>(null);
  const [stale, setStale] = useState(false);
  const [catalogStale, setCatalogStale] = useState(false);
  const [confirmPublish, setConfirmPublish] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [publishing, setPublishing] = useState(false);
  const editorRef = useRef<HTMLDivElement>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    let active = true;
    setLoad({ kind: 'loading' });
    const historical = request.query.revision !== undefined || request.query.asOf !== undefined;
    void Promise.all([
      getSeasonCalendar(token, request.query),
      historical ? Promise.resolve(null) : getSeasonRules(token),
    ]).then(([calendar, catalog]) => {
      if (!active) return;
      const seasons = catalog?.seasons ?? [];
      setLoad({ kind: 'ready', calendar, seasons, query: request.query });
      setDraft(calendarEntriesToDraft(calendar));
      setValues(emptyEntry(seasons));
      setEditingIndex(null);
      setEntryErrors({});
      setFormTouched(false);
      setSelectedDate(request.query.from ?? calendarYearBounds(calendar.year).from);
      setStale(false);
      setCatalogStale(false);
    }, (error: unknown) => {
      if (!active) return;
      if (error instanceof ApiError && error.status === 401) return logout();
      setLoad(error instanceof ApiError && error.status === 403
        ? { kind: 'forbidden' }
        : { kind: 'error', message: errorMessage(error) });
    });
    return () => { active = false; };
  }, [token, logout, request]);

  const ready = load.kind === 'ready' ? load : null;
  const historical = ready !== null && (ready.query.revision !== undefined || ready.query.asOf !== undefined);
  const dirty = ready !== null && JSON.stringify(draft) !== JSON.stringify(calendarEntriesToDraft(ready.calendar));
  const publishableChange = dirty || ready?.calendar.revision === 0;
  const unsaved = dirty || formTouched;
  const busy = load.kind === 'loading' || publishing;

  useEffect(() => {
    if (!unsaved) return;
    function warnBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = '';
    }
    window.addEventListener('beforeunload', warnBeforeUnload);
    return () => window.removeEventListener('beforeunload', warnBeforeUnload);
  }, [unsaved]);

  const entries = useMemo(() => !ready ? [] : dirty
    ? draftCalendarEntries(draft, ready.seasons)
    : ready.calendar.entries, [ready, dirty, draft]);
  const issues = useMemo(() => !ready || historical ? [] : validateCalendarDraft(
    ready.calendar.year, draft, ready.calendar.carriedInEntries, ready.seasons,
  ), [ready, historical, draft]);
  // Al corregir un borrador se recalculan sus conflictos; los heredados siguen bloqueando.
  const conflicts = !ready ? [] : ready.calendar.conflicts.filter((conflict) => !dirty ||
    conflict.entryIds.every((id) => ready.calendar.carriedInEntries.some((entry) => entry.entryId === id)));
  const defaultRanges = useMemo(() => !ready ? [] : dirty
    ? calendarDefaultRanges(ready.calendar.year, entries, ready.calendar.carriedInEntries, ready.calendar.defaultSeason)
    : ready.calendar.unclassifiedRanges, [ready, dirty, entries]);

  function resetEditor() {
    setValues(emptyEntry(ready?.seasons ?? []));
    setEditingIndex(null);
    setEntryErrors({});
    setFormTouched(false);
  }

  function performAction(action: PendingAction) {
    setNotice(null);
    setConfirmPublish(false);
    setPendingAction(null);
    if (action.kind === 'load') {
      const query = action.query;
      setQueryValues((current) => ({
        ...current, year: String(query.year), from: query.from ?? '', to: query.to ?? '',
        mode: query.revision !== undefined ? 'revision' : query.asOf !== undefined ? 'asOf' : 'current',
        revision: query.revision === undefined ? '' : String(query.revision),
        asOf: query.asOf === undefined ? '' : colombiaDateTimeInput(query.asOf),
      }));
      setQueryErrors({});
      setRequest({ query });
    } else if (action.kind === 'edit') {
      openEditor(action.entryId);
    } else if (ready) {
      setDraft(calendarEntriesToDraft(ready.calendar));
      resetEditor();
    }
  }

  function requestAction(action: PendingAction) {
    if (busy) return;
    if (unsaved) setPendingAction(action);
    else performAction(action);
  }

  function submitQuery() {
    const parsed = parseCalendarQuery(queryValues);
    if (!parsed.ok) return setQueryErrors(parsed.errors);
    setQueryErrors({});
    requestAction({ kind: 'load', query: parsed.query });
  }

  function changeEntry(field: keyof CalendarEntryInput, value: string) {
    setValues((current) => {
      const next = { ...current, [field]: value };
      if ((field === 'kind' && value === 'EXCEPTION') || (field === 'startDate' && current.kind === 'EXCEPTION')) {
        next.endDate = next.startDate;
      }
      return next;
    });
    setEntryErrors({});
    setFormTouched(true);
    setNotice(null);
  }

  function saveEntry() {
    if (!ready || historical || busy) return;
    const errors = validateCalendarEntry(ready.calendar.year, values, ready.seasons);
    setEntryErrors(errors);
    if (Object.keys(errors).length) return;
    setDraft((current) => editingIndex === null ? [...current, { ...values }]
      : current.map((entry, index) => index === editingIndex ? { ...values } : entry));
    resetEditor();
    setNotice(null);
  }

  function openEditor(entryId: string) {
    if (busy || historical) return;
    const index = entries.findIndex((entry) => entry.entryId === entryId);
    if (index === -1) return;
    setValues({ ...draft[index] });
    setEditingIndex(index);
    setEntryErrors({});
    setFormTouched(false);
    setNotice(null);
    editorRef.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
    editorRef.current?.querySelector<HTMLSelectElement>('select')?.focus();
  }

  function editEntry(entryId: string) {
    if (busy || historical) return;
    if (formTouched) setPendingAction({ kind: 'edit', entryId });
    else openEditor(entryId);
  }

  function removeEntry(entryId: string) {
    if (busy || historical) return;
    const index = entries.findIndex((entry) => entry.entryId === entryId);
    if (index === -1) return;
    setDraft((current) => current.filter((_, position) => position !== index));
    if (editingIndex === index) resetEditor();
    else if (editingIndex !== null && editingIndex > index) setEditingIndex(editingIndex - 1);
    setNotice(null);
  }

  async function publish() {
    if (!ready || historical || publishing || stale || catalogStale || !publishableChange || formTouched || issues.length || conflicts.length) return;
    setPublishing(true);
    setNotice(null);
    try {
      const calendar = await publishSeasonCalendar(token, ready.calendar.year, draft, ready.calendar.revision || null);
      if (!mounted.current) return;
      const updatedSeasons = new Map(ready.seasons.map((season) => [season.seasonId, season]));
      for (const season of [calendar.defaultSeason, ...calendar.entries.map((entry) => entry.season), ...calendar.carriedInEntries.map((entry) => entry.season)]) {
        updatedSeasons.set(season.seasonId, season);
      }
      setLoad({ ...ready, calendar, seasons: [...updatedSeasons.values()] });
      setDraft(calendarEntriesToDraft(calendar));
      resetEditor();
      setNotice({ variant: 'success', title: `Calendario publicado · Revisión ${calendar.revision}`,
        description: 'Las nuevas cotizaciones usarán esta clasificación. Las cotizaciones anteriores conservan sus valores.' });
    } catch (error) {
      if (!mounted.current) return;
      if (error instanceof ApiError && error.status === 401) return logout();
      if (error instanceof ApiError && error.status === 403) return setLoad({ kind: 'forbidden' });
      if (error instanceof ApiError && error.errorCode === 'SEASON_CALENDAR_CONFLICT') {
        setStale(true);
      } else {
        if (error instanceof ApiError && error.errorCode === 'UNKNOWN_SEASON_REFERENCE') setCatalogStale(true);
        const explanation = error instanceof ApiError && error.errorCode === 'OVERLAPPING_SEASON_CALENDAR'
          ? ' Revisa también los períodos de los años vecinos.' : '';
        setNotice({ variant: 'danger', title: 'No se pudo publicar el calendario', description: errorMessage(error) + explanation });
      }
    } finally {
      if (mounted.current) { setPublishing(false); setConfirmPublish(false); }
    }
  }

  const header = <header>
    <h1 className={styles.title}>Calendario de temporadas</h1>
    <p className={styles.subtitle}>Revisa la temporada de cada fecha y configura los períodos y las excepciones del año.</p>
  </header>;

  if (load.kind === 'forbidden') return <div className={styles.page}>{header}
    <Notice variant="danger" title="No tienes permiso" description="Solo el Administrador puede consultar y publicar el calendario de temporadas." />
  </div>;

  const selected = ready && selectedDate ? resolveCalendarDate(selectedDate, entries, ready.calendar.carriedInEntries, ready.calendar.defaultSeason, conflicts) : null;
  const visibleDefaultRanges = defaultRanges.map((range) => ({
    ...range,
    from: ready?.query.from && range.from < ready.query.from ? ready.query.from : range.from,
    to: ready?.query.to && range.to > ready.query.to ? ready.query.to : range.to,
  })).filter((range) => range.from <= range.to);

  return <div className={styles.page}>
    {header}
    <CalendarQueryForm values={queryValues} errors={queryErrors} disabled={busy} onChange={(field, value) => {
      setQueryValues((current) => ({ ...current, [field]: value }));
      setQueryErrors({});
    }} onSubmit={submitQuery} />
    {load.kind === 'loading' && <p role="status" className={styles.muted}>Cargando el calendario…</p>}
    {load.kind === 'error' && <Notice variant="danger" title="No se pudo cargar el calendario" description={load.message}>
      <div className={styles.noticeActions}><Button variant="secondary" onClick={() => setRequest({ query: request.query })}>Reintentar</Button></div>
    </Notice>}
    {(stale || catalogStale) && ready && <Notice variant="danger"
      title={stale ? 'El calendario cambió mientras editabas' : 'El catálogo de temporadas cambió'}
      description={stale
        ? 'Otro Administrador publicó una revisión más reciente. Tu borrador se conserva; recarga el calendario vigente antes de volver a publicar.'
        : 'Una temporada ya no está disponible. Tu borrador se conserva; recarga el calendario y el catálogo antes de volver a publicar.'}>
      <div className={styles.noticeActions}>
        <Button variant="secondary" disabled={busy} onClick={() => requestAction({ kind: 'load', query: { ...ready.query, revision: undefined, asOf: undefined } })}>Recargar calendario</Button>
      </div>
    </Notice>}
    {notice && <Notice {...notice} />}
    {ready && <>
      <Card className={styles.summary}>
        <div className={styles.summaryHeader}>
          <div>
            <h2 className={styles.sectionTitle}>Calendario {ready.calendar.year}</h2>
            <p className={styles.muted}>{historical ? 'Consulta histórica · Solo lectura' : 'Calendario vigente'}
              {' · '}{ready.calendar.revision === 0 ? 'Sin publicación propia' : `Revisión ${ready.calendar.revision}`}
              {dirty && ' · Borrador sin publicar'}
            </p>
          </div>
          {!historical && <div className={styles.actions}>
            <Button variant="secondary" disabled={busy || !unsaved} onClick={() => requestAction({ kind: 'reset' })}>Descartar cambios</Button>
            <Button disabled={busy || !publishableChange || formTouched || stale || catalogStale || issues.length > 0 || conflicts.length > 0}
              onClick={() => setConfirmPublish(true)}>{publishing ? 'Publicando…' : 'Publicar calendario'}</Button>
          </div>}
          {historical && <Button variant="secondary" disabled={busy} onClick={() => requestAction({ kind: 'load', query: { year: ready.calendar.year, from: ready.query.from, to: ready.query.to } })}>Volver al calendario vigente</Button>}
        </div>
        <dl className={styles.metadata}>
          <div><dt>Vigente desde</dt><dd>{ready.calendar.effectiveAt ? formatDateTime(ready.calendar.effectiveAt) : 'Aún no publicado'}</dd></div>
          <div><dt>Responsable</dt><dd>{ready.calendar.changedBy === session?.userId ? session.username : ready.calendar.changedBy ?? 'Sin cambios registrados'}</dd></div>
          <div><dt>Último cambio</dt><dd>{ready.calendar.changedAt ? formatDateTime(ready.calendar.changedAt) : 'Sin cambios registrados'}</dd></div>
          <div><dt>Consulta realizada a</dt><dd>{formatDateTime(ready.calendar.asOf)} · Colombia</dd></div>
        </dl>
        <CalendarLegend seasons={[
          ...(!historical ? ready.seasons : []), ready.calendar.defaultSeason,
          ...entries.map((entry) => entry.season), ...ready.calendar.carriedInEntries.map((entry) => entry.season),
        ]} />
      </Card>
      {(issues.length > 0 || conflicts.length > 0) && <Notice variant="danger" title="Hay conflictos que impiden publicar" description="Corrige las asignaciones indicadas. Los períodos heredados se modifican en su año de origen.">
        <ul className={styles.issues}>
          {issues.map((issue, index) => <li key={`draft-${index}`}>{issue.message}</li>)}
          {conflicts.map((conflict, index) => <li key={`server-${index}`}>{formatCalendarDate(conflict.dates.from)} – {formatCalendarDate(conflict.dates.to)}: {conflict.message}</li>)}
        </ul>
      </Notice>}
      {dirty && <Notice variant="info" title="Vista previa del borrador" description="Los cambios se aplicarán cuando publiques el calendario completo del año." />}
      {formTouched && <Notice variant="neutral" title="Hay una asignación en edición" description="Agrega o guarda la asignación, o cancela su edición antes de publicar." />}
      <YearCalendar year={ready.calendar.year} entries={entries} carriedInEntries={ready.calendar.carriedInEntries} defaultSeason={ready.calendar.defaultSeason} conflicts={conflicts}
        from={ready.query.from} to={ready.query.to} selectedDate={selectedDate} onSelectDate={setSelectedDate} />
      <div className={styles.details}>
        {selected && <Card className={styles.dayDetail} aria-labelledby="selected-date-title">
          <h2 id="selected-date-title" className={styles.sectionTitle}>{formatCalendarDate(selected.date)}</h2>
          <p className={styles.daySeason}>{selected.season?.name ?? 'Conflicto de clasificación'}</p>
          <p className={styles.muted}>{selected.source === 'DEFAULT' ? 'Predeterminada (DEFAULT) · Sin asignación explícita'
            : selected.source === 'EXCEPTION' ? 'Excepción de un día · Prevalece sobre el período base'
            : selected.source === 'BASE' ? `Período base${selected.inherited ? ' · Heredado del año anterior' : ''}` : 'Resuelve el conflicto para obtener una temporada válida.'}</p>
          {selected.season?.adjustmentPercent != null && <p>Ajuste sobre la tarifa base: <strong>{Number(selected.season.adjustmentPercent) > 0 ? '+' : ''}{formatPercent(selected.season.adjustmentPercent)}</strong></p>}
          {selected.entry && <p className={styles.muted}>Del {formatCalendarDate(selected.entry.startDate)} al {formatCalendarDate(selected.entry.endDate)}, ambos incluidos.</p>}
          {selected.conflicts.length > 0 && <ul className={styles.issues}>{selected.conflicts.map((conflict, index) => <li key={index}>{conflict.message}</li>)}</ul>}
        </Card>}
        {!historical && <div className={styles.editor} ref={editorRef}>
          <CalendarEntryForm year={ready.calendar.year} seasons={ready.seasons} values={values} errors={entryErrors} editing={editingIndex !== null} disabled={busy}
            onChange={changeEntry} onSubmit={saveEntry} onCancel={resetEditor} />
          {ready.seasons.length === 0 && <Notice variant="danger" title="No hay temporadas disponibles" description="Configura el catálogo de temporadas antes de agregar asignaciones." />}
        </div>}
      </div>
      <CalendarEntriesTable entries={entries} carriedInEntries={ready.calendar.carriedInEntries} readOnly={historical} disabled={busy}
        onEdit={editEntry} onRemove={removeEntry} onOpenYear={(year) => requestAction({ kind: 'load', query: { year, ...(ready.query.asOf ? { asOf: ready.query.asOf } : historical ? { asOf: ready.calendar.asOf } : {}) } })} />
      <Card className={styles.defaults}>
        <h2 className={styles.sectionTitle}>Fechas con temporada predeterminada</h2>
        <p className={styles.muted}>Sin una asignación explícita, se aplica {ready.calendar.defaultSeason.name ?? 'la temporada predeterminada'} del catálogo de temporadas.</p>
        {visibleDefaultRanges.length > 0 ? <details>
          <summary>{visibleDefaultRanges.length} {visibleDefaultRanges.length === 1 ? 'rango sin asignación explícita' : 'rangos sin asignación explícita'} en la consulta</summary>
          <ul className={styles.ranges}>{visibleDefaultRanges.map((range) => <li key={range.from}>{formatCalendarDate(range.from)} – {formatCalendarDate(range.to)} · DEFAULT</li>)}</ul>
        </details> : <p className={styles.muted}>No hay fechas sin asignación explícita en el rango consultado.</p>}
      </Card>
    </>}
    {confirmPublish && ready && <Modal title="Publicar calendario"
      description={`Se publicarán las ${draft.length} asignaciones propias de ${ready.calendar.year} como una nueva revisión. Las asignaciones que quitaste dejarán de aplicarse; los períodos heredados se conservan en su año de origen.`}
      onClose={publishing ? undefined : () => setConfirmPublish(false)}
      actions={<><Button variant="secondary" disabled={publishing} onClick={() => setConfirmPublish(false)}>Seguir editando</Button><Button disabled={publishing} onClick={() => void publish()}>{publishing ? 'Publicando…' : 'Confirmar publicación'}</Button></>}>
      <p className={styles.muted}>La revisión anterior queda disponible para auditoría. Las cotizaciones ya guardadas conservan sus valores.</p>
    </Modal>}
    {pendingAction && <Modal title="Descartar cambios" description={pendingAction.kind === 'edit'
      ? 'Si continúas, se descartarán los cambios de la asignación en edición. Las asignaciones que ya guardaste en el borrador se conservan.'
      : 'Tienes cambios sin publicar. Si continúas, se descartarán el borrador y la asignación en edición.'}
      onClose={() => setPendingAction(null)} actions={<><Button variant="secondary" onClick={() => setPendingAction(null)}>Seguir editando</Button><Button onClick={() => performAction(pendingAction)}>Descartar y continuar</Button></>} />}
  </div>;
}
