// Feature 009 · Modificar precio tarifa según temporada
import { useEffect, useRef, useState } from 'react';
import { ApiError } from '../../api/http';
import {
  createSeasonRule,
  retireSeasonRule,
  SeasonRule,
  SeasonRuleInput,
  updateSeasonRule,
} from '../../api/seasonRules';
import { useAuth } from '../../auth/AuthContext';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { Notice } from '../../components/ui/Notice';
import { parseSeasonInput, SeasonInputErrors } from '../../lib/seasonInput';
import { DefaultSeasonCard } from './DefaultSeasonCard';
import { RetireSeasonModal } from './RetireSeasonModal';
import { SeasonForm, SeasonNotice } from './SeasonForm';
import { SeasonRulesTable } from './SeasonRulesTable';
import { useSeasonRules } from './useSeasonRules';
import styles from './SeasonRulesPage.module.css';

const EMPTY_FORM: SeasonRuleInput = { name: '', color: '#808080', adjustmentPercent: '' };

function valuesOf(season: SeasonRule): SeasonRuleInput {
  return { name: season.name, color: season.color, adjustmentPercent: season.adjustmentPercent };
}

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : 'No fue posible completar la operación. Reintenta.';
}

export function SeasonRulesPage() {
  const { session, logout } = useAuth();
  const token = session?.token ?? '';
  const { load, reload, upsert, remove } = useSeasonRules();
  const [editor, setEditor] = useState<SeasonRule | null>(null);
  const [values, setValues] = useState<SeasonRuleInput>(EMPTY_FORM);
  const [errors, setErrors] = useState<SeasonInputErrors>({});
  const [notice, setNotice] = useState<SeasonNotice | null>(null);
  const [action, setAction] = useState<'save' | 'retire' | 'reload' | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [needsReload, setNeedsReload] = useState(false);
  const [reloadError, setReloadError] = useState<string | null>(null);
  const [retireTarget, setRetireTarget] = useState<SeasonRule | null>(null);
  const [retireError, setRetireError] = useState<string | null>(null);
  const [focusRequest, setFocusRequest] = useState(0);
  const editorRef = useRef<HTMLDivElement>(null);
  const busy = action !== null;

  useEffect(() => {
    if (focusRequest === 0) return;
    editorRef.current?.querySelector<HTMLInputElement>('input:not(:disabled)')?.focus();
    editorRef.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  }, [focusRequest]);

  function handleAccess(error: unknown): boolean {
    if (error instanceof ApiError && error.status === 401) {
      logout();
      return true;
    }
    if (error instanceof ApiError && error.status === 403) {
      setForbidden(true);
      return true;
    }
    return false;
  }

  function resetEditor() {
    setEditor(null);
    setValues(EMPTY_FORM);
    setErrors({});
    setNotice(null);
    setNeedsReload(false);
  }

  function beginCreate() {
    if (busy) return;
    resetEditor();
    setFocusRequest((value) => value + 1);
  }

  function beginEdit(season: SeasonRule) {
    if (busy) return;
    setEditor(season);
    setValues(valuesOf(season));
    setErrors({});
    setNotice(null);
    setNeedsReload(false);
    setFocusRequest((value) => value + 1);
  }

  function handleChange(field: keyof SeasonRuleInput, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
    setNotice(null);
  }

  async function handleSave() {
    if (busy || needsReload) return;
    const parsed = parseSeasonInput(values);
    if (!parsed.ok) {
      setErrors(parsed.errors);
      return;
    }
    const input = parsed.value;
    if (
      editor &&
      input.name === editor.name &&
      input.color === editor.color &&
      input.adjustmentPercent === editor.adjustmentPercent
    ) {
      setNotice({ variant: 'neutral', title: 'No hay cambios por guardar' });
      return;
    }

    setAction('save');
    setNotice(null);
    try {
      const saved = editor
        ? await updateSeasonRule(token, editor.seasonId, input, editor.version)
        : await createSeasonRule(token, input);
      upsert(saved);
      if (editor) {
        setEditor(saved);
        setValues(valuesOf(saved));
      } else resetEditor();
      setErrors({});
      setNotice({
        variant: 'success',
        title: `${saved.name}: ${editor ? 'cambios guardados' : 'temporada creada'}`,
        description:
          'El ajuste ya se aplica a las nuevas cotizaciones. Los valores anteriores se conservan.',
      });
    } catch (error) {
      if (handleAccess(error)) return;
      if (error instanceof ApiError) {
        if (error.errorCode === 'SEASON_NAME_CONFLICT') {
          setErrors({ name: error.message });
          return;
        }
        if (error.errorCode === 'INVALID_SEASON_ADJUSTMENT') {
          setErrors({ adjustmentPercent: error.message });
          return;
        }
        if (error.errorCode === 'SEASON_RULE_CONFLICT') {
          setReloadError(null);
          setConflict(true);
          return;
        }
        if (error.errorCode === 'SEASON_NOT_FOUND') setNeedsReload(true);
      }
      setNotice({
        variant: 'danger',
        title: 'No se pudo guardar la temporada',
        description: errorMessage(error),
      });
    } finally {
      setAction(null);
    }
  }

  async function handleReload(reloadEditor = false) {
    if (busy) return;
    setAction('reload');
    setReloadError(null);
    try {
      const catalog = await reload();
      if ((reloadEditor || needsReload) && editor) {
        const latest = catalog.seasons.find((season) => season.seasonId === editor.seasonId);
        if (latest && reloadEditor) {
          setEditor(latest);
          setValues(valuesOf(latest));
          setErrors({});
          setNotice({
            variant: 'neutral',
            title: 'Temporada actualizada',
            description: 'Revisa los valores vigentes antes de editar de nuevo.',
          });
        } else if (!latest) {
          resetEditor();
          setNotice({
            variant: 'neutral',
            title: 'La temporada ya no está disponible',
            description: 'Otro Administrador la retiró del catálogo.',
          });
        }
      }
      setNeedsReload(false);
      setConflict(false);
    } catch (error) {
      if (handleAccess(error)) return;
      setReloadError(errorMessage(error));
    } finally {
      setAction(null);
    }
  }

  async function handleRetire() {
    if (busy || !retireTarget || retireTarget.isDefault) return;
    setAction('retire');
    setRetireError(null);
    try {
      await retireSeasonRule(token, retireTarget.seasonId);
      remove(retireTarget.seasonId);
      if (editor?.seasonId === retireTarget.seasonId) resetEditor();
      setNotice({
        variant: 'success',
        title: `${retireTarget.name}: temporada retirada`,
        description: 'Su historial y los valores ya cotizados se conservan.',
      });
      setRetireTarget(null);
      // El botón que abrió el diálogo desaparece junto con la fila retirada.
      setFocusRequest((value) => value + 1);
    } catch (error) {
      if (handleAccess(error)) return;
      if (error instanceof ApiError && error.errorCode === 'SEASON_NOT_FOUND') {
        setRetireTarget(null);
        setNeedsReload(true);
        setNotice({
          variant: 'danger',
          title: 'La temporada ya no está disponible',
          description: 'Actualiza el catálogo para revisar los datos vigentes.',
        });
      } else {
        setRetireError(
          error instanceof ApiError && error.errorCode === 'SEASON_IN_USE'
            ? `${error.message} Retira sus asignaciones del calendario vigente antes de reintentar.`
            : errorMessage(error),
        );
      }
    } finally {
      setAction(null);
    }
  }

  const header = (
    <header>
      <h1 className={styles.title}>Temporadas y tarifas</h1>
      <p className={styles.subtitle}>Configura el ajuste sobre la tarifa base de cada temporada.</p>
    </header>
  );

  if (forbidden || load.kind === 'forbidden') {
    return (
      <div className={styles.page}>
        {header}
        <Notice
          variant="danger"
          title="No tienes permiso"
          description={`Tu rol es ${session?.role || 'desconocido'}. Solo el Administrador gestiona las temporadas.`}
        />
      </div>
    );
  }
  if (load.kind === 'loading') {
    return (
      <div className={styles.page}>
        {header}
        <p className={styles.loading} role="status">
          Cargando las temporadas…
        </p>
      </div>
    );
  }
  if (load.kind === 'error') {
    return (
      <div className={styles.page}>
        {header}
        <Notice
          variant="danger"
          title="No se pudo cargar el catálogo"
          description={reloadError ?? load.message}
        >
          <div className={styles.retry}>
            <Button variant="secondary" disabled={busy} onClick={() => void handleReload()}>
              {busy ? 'Cargando…' : 'Reintentar'}
            </Button>
          </div>
        </Notice>
      </div>
    );
  }

  const { seasons } = load.catalog;
  return (
    <div className={styles.page}>
      {header}
      {needsReload && (
        <Notice
          variant="danger"
          title="Actualiza el catálogo"
          description="Una temporada cambió o fue retirada por otro Administrador."
        >
          <div className={styles.retry}>
            <Button variant="secondary" disabled={busy} onClick={() => void handleReload()}>
              Actualizar catálogo
            </Button>
          </div>
        </Notice>
      )}
      {reloadError && !conflict && (
        <Notice
          variant="danger"
          title="No se pudo recargar el catálogo"
          description={reloadError}
        />
      )}
      <div className={styles.cards}>
        <DefaultSeasonCard season={seasons.find((season) => season.isDefault)} />
        <div className={styles.formColumn} ref={editorRef}>
          <SeasonForm
            season={editor}
            values={values}
            errors={errors}
            notice={notice}
            busy={busy || needsReload}
            saving={action === 'save'}
            onChange={handleChange}
            onSubmit={() => void handleSave()}
            onCancel={resetEditor}
          />
        </div>
      </div>
      <SeasonRulesTable
        seasons={seasons}
        selectedId={editor?.seasonId}
        disabled={busy || conflict || retireTarget !== null}
        currentUserId={session?.userId}
        currentUsername={session?.username}
        onCreate={beginCreate}
        onEdit={beginEdit}
        onRetire={(season) => {
          setRetireTarget(season);
          setRetireError(null);
        }}
      />
      {retireTarget && (
        <RetireSeasonModal
          season={retireTarget}
          retiring={action === 'retire'}
          error={retireError}
          onCancel={() => setRetireTarget(null)}
          onConfirm={() => void handleRetire()}
        />
      )}
      {conflict && (
        <Modal
          title="La temporada cambió mientras editabas"
          description="Otro Administrador guardó una versión más reciente. Recargar reemplazará tu edición por los valores vigentes para que los revises antes de guardar."
          onClose={busy ? undefined : () => setConflict(false)}
          actions={
            <>
              <Button variant="secondary" disabled={busy} onClick={() => setConflict(false)}>
                Cancelar
              </Button>
              <Button disabled={busy} onClick={() => void handleReload(true)}>
                {busy ? 'Recargando…' : 'Recargar temporada'}
              </Button>
            </>
          }
        >
          {reloadError && (
            <Notice
              variant="danger"
              title="No se pudo recargar la temporada"
              description={reloadError}
            />
          )}
        </Modal>
      )}
    </div>
  );
}
