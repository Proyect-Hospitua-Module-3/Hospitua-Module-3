// Feature 008 · Resumen consolidado de facturas por canal.
import { useEffect, useId, useRef } from 'react';
import type { InvoiceChannelSummary, InvoiceSummaryRange } from '../../api/invoices';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Notice } from '../../components/ui/Notice';
import { formatInvoiceMoney, invoiceChannelLabel, InvoiceRangeErrors } from '../../lib/invoices';
import styles from './InvoicesPage.module.css';

export type SummaryState =
  | { kind: 'idle' }
  | { kind: 'loading'; range: InvoiceSummaryRange }
  | { kind: 'ready'; result: InvoiceChannelSummary }
  | { kind: 'error'; message: string; range: InvoiceSummaryRange };

interface Props {
  values: InvoiceSummaryRange;
  errors: InvoiceRangeErrors;
  state: SummaryState;
  onChange(field: keyof InvoiceSummaryRange, value: string): void;
  onSubmit(): void;
  onRetry(): void;
}

export function InvoiceSummaryPanel({ values, errors, state, onChange, onSubmit, onRetry }: Props) {
  const id = useId();
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (Object.values(errors).some(Boolean))
      form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [errors]);

  return (
    <Card className={styles.card} aria-labelledby={`${id}-title`}>
      <div>
        <h2 id={`${id}-title`} className={styles.sectionTitle}>
          Resumen por canal
        </h2>
        <p className={styles.muted}>
          Consulta los importes facturados en un período, separados por canal directo y por OTA.
        </p>
      </div>
      <form
        ref={form}
        aria-label="Consultar resumen por canal"
        className={styles.form}
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <div className={styles.summaryFields}>
          {(['issuedFrom', 'issuedTo'] as const).map((field) => (
            <div key={field} className={styles.field}>
              <label htmlFor={`${id}-${field}`}>
                {field === 'issuedFrom' ? 'Resumen desde' : 'Resumen hasta'}
              </label>
              <input
                id={`${id}-${field}`}
                className={styles.control}
                type="date"
                min="0001-01-01"
                max="9999-12-31"
                value={values[field]}
                onChange={(event) => onChange(field, event.target.value)}
                aria-invalid={!!errors[field]}
                aria-describedby={errors[field] ? `${id}-${field}-error` : `${id}-range-help`}
              />
              {errors[field] && (
                <p id={`${id}-${field}-error`} role="alert" className={styles.fieldError}>
                  {errors[field]}
                </p>
              )}
            </div>
          ))}
          <Button type="submit" aria-busy={state.kind === 'loading'}>
            Consultar resumen
          </Button>
        </div>
        <p id={`${id}-range-help`} className={styles.help}>
          Ambas fechas son obligatorias e inclusivas. Los importes corresponden a facturas emitidas,
          sin recalcularlas.
        </p>
      </form>
      {state.kind === 'idle' && (
        <p className={styles.muted}>Selecciona un período para consultar el resumen.</p>
      )}
      {state.kind === 'loading' && (
        <p className={styles.muted} role="status">
          Consultando el resumen…
        </p>
      )}
      {state.kind === 'error' && (
        <Notice
          variant="danger"
          title="No se pudo consultar el resumen"
          description={state.message}
        >
          <div className={styles.noticeActions}>
            <Button variant="secondary" onClick={onRetry}>
              Reintentar resumen
            </Button>
          </div>
        </Notice>
      )}
      {state.kind === 'ready' && (
        <>
          <p className={styles.muted} role="status">
            Período {state.result.range.issuedFrom} al {state.result.range.issuedTo} · Zona horaria:{' '}
            {state.result.timezone}
          </p>
          {state.result.channels.every((channel) => channel.invoiceCount === 0) && (
            <Notice
              variant="neutral"
              title="Sin facturas en el período"
              description="Los canales conocidos se muestran con sus totales en cero."
            />
          )}
          <div
            className={styles.tableWrapper}
            tabIndex={0}
            role="region"
            aria-label="Totales de facturas por canal"
          >
            <table
              className={`${styles.table} ${styles.summaryTable}`}
              aria-label="Resumen por canal"
            >
              <thead>
                <tr>
                  <th scope="col">Canal</th>
                  <th scope="col">Facturas</th>
                  <th scope="col">Hospedaje</th>
                  <th scope="col">Comisión OTA</th>
                  <th scope="col">IVA</th>
                  <th scope="col">Total facturado</th>
                </tr>
              </thead>
              <tbody>
                {state.result.channels.map((channel) => (
                  <tr key={`${channel.channel}-${channel.otaId ?? ''}`}>
                    <th scope="row">{invoiceChannelLabel(channel.channel, channel.otaId)}</th>
                    <td>{channel.invoiceCount}</td>
                    {[
                      channel.totalLodging,
                      channel.totalOtaCommission,
                      channel.totalVat,
                      channel.totalInvoiced,
                    ].map((amount, index) => (
                      <td key={index} className={styles.money}>
                        {formatInvoiceMoney(amount, state.result.currency)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className={styles.help}>
            Directo aparece siempre. Las OTA con facturas históricas aparecen aunque no hayan
            facturado en este período.
          </p>
        </>
      )}
    </Card>
  );
}
