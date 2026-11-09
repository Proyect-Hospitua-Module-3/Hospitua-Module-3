// Feature 001 · Actualizar porcentaje de IVA
// Pantalla "03 · Porcentaje de IVA" del diseño de Figma, con sus estados 1, 2 y 5 a 9.
// Los estados 3, 4 y 10 (facturas emitidas antes, durante y después del cambio) los
// garantiza el backend (006 guarda el porcentaje en cada factura) y se ven en la pantalla
// de facturas, no en esta.
import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '../../api/http';
import {
  CurrentVatRate,
  getVatRateOverview,
  updateVatRate,
  VatRateOverview,
} from '../../api/vatRate';
import { useAuth } from '../../auth/AuthContext';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { Notice } from '../../components/ui/Notice';
import { formatDateTimeShort, formatPercent } from '../../lib/format';
import { parseVatInput, vatInputErrorMessage } from '../../lib/vatInput';
import { CurrentVatCard } from './CurrentVatCard';
import { FormNotice, UpdateVatForm } from './UpdateVatForm';
import { VatHistoryTable } from './VatHistoryTable';
import styles from './VatRatePage.module.css';

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; overview: VatRateOverview }
  | { kind: 'forbidden' }
  | { kind: 'error'; message: string };

// El vigente que se cargó sigue siendo el mismo (nadie guardó entretanto).
function sameVersion(a: CurrentVatRate | null, b: CurrentVatRate | null): boolean {
  if (!a || !b) return a === b;
  return a.value === b.value && a.updatedAt === b.updatedAt;
}

export function VatRatePage() {
  const { session, logout } = useAuth();
  const token = session?.token ?? '';
  const [load, setLoad] = useState<LoadState>({ kind: 'loading' });
  const [input, setInput] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [notice, setNotice] = useState<FormNotice | null>(null);
  const [saving, setSaving] = useState(false);
  // Estado 5: otro Administrador guardó mientras se editaba.
  const [conflict, setConflict] = useState<CurrentVatRate | null | undefined>(undefined);

  const fetchOverview = useCallback(async () => {
    try {
      const overview = await getVatRateOverview(token);
      setLoad({ kind: 'ready', overview });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) return logout();
      if (error instanceof ApiError && error.status === 403) return setLoad({ kind: 'forbidden' });
      setLoad({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Error desconocido.',
      });
    }
  }, [token, logout]);

  useEffect(() => {
    void fetchOverview();
  }, [fetchOverview]);

  const header = <h1 className={styles.title}>Porcentaje de IVA</h1>;

  if (load.kind === 'loading') {
    return (
      <div className={styles.page}>
        {header}
        <p className={styles.loading} role="status">
          Cargando el porcentaje de IVA…
        </p>
      </div>
    );
  }

  // Estado 9: solo el Administrador (FR-006, BR-001, SC-005).
  if (load.kind === 'forbidden') {
    return (
      <div className={styles.page}>
        {header}
        <Notice
          variant="danger"
          title="No tienes permiso"
          description={`Tu rol es ${session?.role || 'desconocido'}. Solo el Administrador gestiona el IVA.`}
        />
      </div>
    );
  }

  if (load.kind === 'error') {
    return (
      <div className={styles.page}>
        {header}
        <Notice
          variant="danger"
          title="No se pudo cargar el porcentaje de IVA"
          description={load.message}
        >
          <div className={styles.retry}>
            <Button variant="secondary" onClick={() => void fetchOverview()}>
              Reintentar
            </Button>
          </div>
        </Notice>
      </div>
    );
  }

  const { current, history } = load.overview;

  function handleChange(value: string) {
    setInput(value);
    setFieldError(null);
    setNotice(null);
  }

  function handleCancel() {
    handleChange('');
  }

  async function handleSubmit() {
    const parsed = parseVatInput(input);
    // Estado 2: se rechaza y se conserva el vigente (HU1 esc. 2, FR-002, SC-003).
    if (!parsed.ok) {
      setFieldError(vatInputErrorMessage(parsed.error, current && formatPercent(current.value)));
      return;
    }
    // Estado 6: el mismo valor no cambia nada (casos límite).
    if (current && parsed.value === current.value) {
      setNotice({ variant: 'neutral', title: `${formatPercent(current.value)} ya es el vigente` });
      return;
    }

    setSaving(true);
    try {
      // Estado 5: si otro Administrador guardó desde que se cargó la pantalla, no se pisa
      // su cambio sin que lo vea (FR-007).
      const latest = await getVatRateOverview(token);
      if (!sameVersion(latest.current, current)) {
        setConflict(latest.current);
        return;
      }

      const saved = await updateVatRate(token, parsed.value);
      const refreshed = await getVatRateOverview(token).catch(() => null);
      setLoad({
        kind: 'ready',
        overview: refreshed ?? {
          current: { ...saved, updatedByUsername: session?.username ?? null },
          history,
        },
      });
      setInput('');
      // Estado 1: vigente de inmediato y registrado (HU1 esc. 1, NFR-003, SC-004).
      setNotice({
        variant: 'success',
        title: `IVA vigente: ${formatPercent(saved.value)}`,
        description: [
          session?.username,
          formatDateTimeShort(saved.updatedAt),
          current ? `antes ${formatPercent(current.value)}` : 'primer porcentaje registrado',
        ]
          .filter(Boolean)
          .join(' · '),
      });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) return logout();
      if (error instanceof ApiError && error.errorCode === 'INVALID_VAT_RATE') {
        setFieldError(vatInputErrorMessage('range', current && formatPercent(current.value)));
      } else if (error instanceof ApiError && error.status === 403) {
        setNotice({
          variant: 'danger',
          title: 'No tienes permiso',
          description: `Tu rol es ${session?.role || 'desconocido'}.`,
        });
      } else {
        // Estado 7: sin responsable y fecha registrados no se guarda (FR-005, NFR-001).
        setNotice({
          variant: 'danger',
          title: 'No se guardó el cambio',
          description:
            error instanceof ApiError && error.status === 0
              ? error.message
              : 'No fue posible registrar responsable y fecha. El porcentaje vigente no cambió.',
        });
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleReload() {
    setConflict(undefined);
    await fetchOverview();
  }

  return (
    <div className={styles.page}>
      {header}

      {/* Estado 8: sin porcentaje no se puede facturar (CL-5, FR-003, BR-003). */}
      {!current && (
        <Notice
          variant="danger"
          title="Configura un porcentaje de IVA"
          description="La facturación está bloqueada hasta que registres el primero."
        />
      )}

      <div className={styles.cards}>
        <CurrentVatCard current={current} />
        <UpdateVatForm
          value={input}
          fieldError={fieldError}
          notice={notice}
          saving={saving}
          onChange={handleChange}
          onSubmit={() => void handleSubmit()}
          onCancel={handleCancel}
        />
      </div>

      <VatHistoryTable history={history} />

      {conflict !== undefined && (
        <Modal
          title="El IVA cambió mientras editabas"
          description={
            conflict
              ? `${conflict.updatedByUsername ?? 'Otro Administrador'} guardó ${formatPercent(conflict.value)}. Recarga antes de guardar.`
              : 'Otro Administrador cambió el porcentaje. Recarga antes de guardar.'
          }
          actions={<Button onClick={() => void handleReload()}>Recargar</Button>}
        />
      )}
    </div>
  );
}
