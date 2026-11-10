// Feature 008 · Buscar facturas, consultar su detalle y consolidar por canal.
import { useEffect, useRef, useState } from 'react';
import { ApiError } from '../../api/http';
import {
  getInvoiceDetail,
  getInvoicesSummary,
  InvoiceDetail,
  InvoiceSearchQuery,
  InvoiceSearchResult,
  InvoiceSummaryRange,
  searchInvoices,
} from '../../api/invoices';
import { useAuth } from '../../auth/AuthContext';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { Notice } from '../../components/ui/Notice';
import {
  EMPTY_INVOICE_SEARCH,
  InvoiceRangeErrors,
  InvoiceSearchErrors,
  InvoiceSearchInput,
  parseInvoiceSearchInput,
  parseInvoiceSummaryRange,
} from '../../lib/invoices';
import { InvoiceDetailView } from './InvoiceDetailView';
import { InvoiceResults } from './InvoiceResults';
import { InvoiceSearchForm } from './InvoiceSearchForm';
import { InvoiceSummaryPanel, SummaryState } from './InvoiceSummaryPanel';
import styles from './InvoicesPage.module.css';

type SearchState =
  | { kind: 'idle' }
  | { kind: 'loading'; query: InvoiceSearchQuery }
  | { kind: 'ready'; query: InvoiceSearchQuery; result: InvoiceSearchResult }
  | { kind: 'error'; query: InvoiceSearchQuery; message: string };

type DetailState =
  | { kind: 'loading'; invoiceId: string }
  | { kind: 'ready'; invoiceId: string; invoice: InvoiceDetail }
  | { kind: 'error'; invoiceId: string; message: string; notFound: boolean };

function messageOf(error: unknown): string {
  return error instanceof Error
    ? error.message
    : 'No fue posible completar la consulta. Reintenta.';
}

export function InvoicesPage() {
  const { session, logout } = useAuth();
  const token = session?.token ?? '';
  const [forbidden, setForbidden] = useState(session?.role !== 'Administrador');
  const [filters, setFilters] = useState<InvoiceSearchInput>({ ...EMPTY_INVOICE_SEARCH });
  const [errors, setErrors] = useState<InvoiceSearchErrors>({});
  const [search, setSearch] = useState<SearchState>({ kind: 'idle' });
  const [detail, setDetail] = useState<DetailState | null>(null);
  const [summaryRange, setSummaryRange] = useState<InvoiceSummaryRange>({
    issuedFrom: '',
    issuedTo: '',
  });
  const [summaryErrors, setSummaryErrors] = useState<InvoiceRangeErrors>({});
  const [summary, setSummary] = useState<SummaryState>({ kind: 'idle' });
  const searchSequence = useRef(0);
  const detailSequence = useRef(0);
  const summarySequence = useRef(0);

  // Una consulta anterior, una sesión anterior o una pantalla desmontada nunca
  // reemplazan los resultados de una petición posterior.
  useEffect(
    () => () => {
      searchSequence.current += 1;
      detailSequence.current += 1;
      summarySequence.current += 1;
    },
    [token],
  );

  function handleAccess(error: unknown): boolean {
    if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
      searchSequence.current += 1;
      detailSequence.current += 1;
      summarySequence.current += 1;
      if (error.status === 401) logout();
      else setForbidden(true);
      return true;
    }
    return false;
  }

  async function runSearch(query: InvoiceSearchQuery) {
    if (forbidden) return;
    const sequence = ++searchSequence.current;
    setSearch({ kind: 'loading', query });
    try {
      const result = await searchInvoices(token, query);
      if (sequence !== searchSequence.current) return;
      setSearch({ kind: 'ready', query, result });
    } catch (error) {
      if (sequence !== searchSequence.current || handleAccess(error)) return;
      setSearch({ kind: 'error', query, message: messageOf(error) });
    }
  }

  function submitSearch() {
    const parsed = parseInvoiceSearchInput(filters);
    if (!parsed.ok) return setErrors(parsed.errors);
    setErrors({});
    void runSearch(parsed.query);
  }

  function changeFilter(field: keyof InvoiceSearchInput, value: string) {
    setFilters((current) => ({
      ...current,
      [field]: value,
      ...(field === 'channel' && value !== 'OTA' ? { otaId: '' } : {}),
    }));
    setErrors({});
    if (field === 'pageSize' && search.kind === 'ready') {
      // Cambiar el tamaño inicia otra búsqueda sobre los criterios aplicados.
      // Los cambios escritos en otros filtros se aplican al pulsar Buscar.
      const { asOf: _previousAsOf, ...query } = search.query;
      void runSearch({ ...query, page: 1, pageSize: Number(value) });
    }
  }

  function clearSearch() {
    searchSequence.current += 1;
    detailSequence.current += 1;
    setFilters({ ...EMPTY_INVOICE_SEARCH });
    setErrors({});
    setSearch({ kind: 'idle' });
    setDetail(null);
  }

  function changePage(page: number) {
    if (search.kind !== 'ready' || page < 1 || page > search.result.totalPages) return;
    void runSearch({ ...search.query, page, asOf: search.result.asOf });
  }

  async function openDetail(invoiceId: string) {
    if (forbidden) return;
    const sequence = ++detailSequence.current;
    setDetail({ kind: 'loading', invoiceId });
    try {
      const invoice = await getInvoiceDetail(token, invoiceId);
      if (sequence !== detailSequence.current) return;
      setDetail({ kind: 'ready', invoiceId, invoice });
    } catch (error) {
      if (sequence !== detailSequence.current || handleAccess(error)) return;
      setDetail({
        kind: 'error',
        invoiceId,
        message: messageOf(error),
        notFound: error instanceof ApiError && error.status === 404,
      });
    }
  }

  function closeDetail() {
    detailSequence.current += 1;
    setDetail(null);
  }

  async function runSummary(range: InvoiceSummaryRange) {
    if (forbidden) return;
    const sequence = ++summarySequence.current;
    setSummary({ kind: 'loading', range });
    try {
      const result = await getInvoicesSummary(token, range);
      if (sequence !== summarySequence.current) return;
      setSummary({ kind: 'ready', result });
    } catch (error) {
      if (sequence !== summarySequence.current || handleAccess(error)) return;
      setSummary({ kind: 'error', range, message: messageOf(error) });
    }
  }

  function submitSummary() {
    const parsed = parseInvoiceSummaryRange(summaryRange);
    if (!parsed.ok) return setSummaryErrors(parsed.errors);
    setSummaryErrors({});
    void runSummary(parsed.range);
  }

  return (
    <div className={styles.page}>
      <header>
        <h1 className={styles.title}>Facturas emitidas</h1>
        <p className={styles.subtitle}>
          Localiza las facturas, revisa su desglose y concilia los importes por canal.
        </p>
      </header>
      {forbidden ? (
        <Notice
          variant="danger"
          title="No tienes permiso"
          description="Solo el Administrador puede consultar las facturas y el resumen por canal."
        />
      ) : (
        <>
          <Notice
            variant="info"
            title="Consulta de solo lectura"
            description="Las facturas conservan sus valores originales. Desde esta pantalla puedes consultarlas, sin modificar ni recalcular sus importes."
          />
          <InvoiceSearchForm
            values={filters}
            errors={errors}
            busy={search.kind === 'loading'}
            onChange={changeFilter}
            onSubmit={submitSearch}
            onClear={clearSearch}
          />
          {search.kind === 'idle' && (
            <Notice
              variant="neutral"
              title="Busca una factura"
              description="Indica al menos un criterio y pulsa Buscar facturas para consultar los resultados."
            />
          )}
          {search.kind === 'loading' && (
            <p role="status" className={styles.muted}>
              Buscando facturas…
            </p>
          )}
          {search.kind === 'error' && (
            <Notice
              variant="danger"
              title="No se pudo buscar las facturas"
              description={search.message}
            >
              <div className={styles.noticeActions}>
                <Button variant="secondary" onClick={() => void runSearch(search.query)}>
                  Reintentar búsqueda
                </Button>
              </div>
            </Notice>
          )}
          {search.kind === 'ready' && (
            <InvoiceResults
              result={search.result}
              query={search.query}
              busy={false}
              onPage={changePage}
              onDetail={(invoiceId) => void openDetail(invoiceId)}
            />
          )}
          <InvoiceSummaryPanel
            values={summaryRange}
            errors={summaryErrors}
            state={summary}
            onChange={(field, value) => {
              setSummaryRange((current) => ({ ...current, [field]: value }));
              setSummaryErrors({});
            }}
            onSubmit={submitSummary}
            onRetry={() => {
              if (summary.kind === 'error') void runSummary(summary.range);
            }}
          />
          {detail && (
            <Modal
              title="Detalle de factura"
              description="Documento emitido e inmutable. Los importes se muestran tal como fueron guardados."
              onClose={closeDetail}
              actions={
                <Button variant="secondary" onClick={closeDetail}>
                  Cerrar detalle
                </Button>
              }
            >
              {detail.kind === 'loading' && (
                <p role="status" className={styles.muted}>
                  Cargando la factura…
                </p>
              )}
              {detail.kind === 'ready' && <InvoiceDetailView invoice={detail.invoice} />}
              {detail.kind === 'error' && (
                <Notice
                  variant="danger"
                  title={detail.notFound ? 'Factura no encontrada' : 'No se pudo cargar la factura'}
                  description={detail.message}
                >
                  {!detail.notFound && (
                    <div className={styles.noticeActions}>
                      <Button variant="secondary" onClick={() => void openDetail(detail.invoiceId)}>
                        Reintentar detalle
                      </Button>
                    </div>
                  )}
                </Notice>
              )}
            </Modal>
          )}
        </>
      )}
    </div>
  );
}
