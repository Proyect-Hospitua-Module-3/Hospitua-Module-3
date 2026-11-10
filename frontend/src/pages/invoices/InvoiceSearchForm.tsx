// Feature 008 · Filtros de búsqueda de facturas.
import { ReactNode, useEffect, useId, useRef } from 'react';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Notice } from '../../components/ui/Notice';
import type { InvoiceSearchErrors, InvoiceSearchInput } from '../../lib/invoices';
import styles from './InvoicesPage.module.css';

interface Props {
  values: InvoiceSearchInput;
  errors: InvoiceSearchErrors;
  busy: boolean;
  onChange(field: keyof InvoiceSearchInput, value: string): void;
  onSubmit(): void;
  onClear(): void;
}

export function InvoiceSearchForm({ values, errors, busy, onChange, onSubmit, onClear }: Props) {
  const id = useId();
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (Object.values(errors).some(Boolean)) {
      form.current
        ?.querySelector<HTMLElement>('[aria-invalid="true"], [data-criteria-error]')
        ?.focus();
    }
  }, [errors]);

  function field(
    name: keyof InvoiceSearchInput,
    label: string,
    control?: ReactNode,
    type = 'text',
  ) {
    return (
      <div className={styles.field} key={name}>
        <label htmlFor={`${id}-${name}`}>{label}</label>
        {control ?? (
          <input
            id={`${id}-${name}`}
            className={styles.control}
            type={type}
            value={values[name]}
            onChange={(event) => onChange(name, event.target.value)}
            aria-invalid={!!errors[name]}
            aria-describedby={errors[name] ? `${id}-${name}-error` : undefined}
            {...(type === 'date' ? { min: '0001-01-01', max: '9999-12-31' } : {})}
          />
        )}
        {errors[name] && (
          <p id={`${id}-${name}-error`} role="alert" className={styles.fieldError}>
            {errors[name]}
          </p>
        )}
      </div>
    );
  }

  return (
    <Card className={styles.card} aria-labelledby={`${id}-title`}>
      <form
        ref={form}
        className={styles.form}
        aria-label="Buscar facturas"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <div>
          <h2 id={`${id}-title`} className={styles.sectionTitle}>
            Buscar facturas
          </h2>
          <p className={styles.muted}>
            Combina uno o varios criterios para localizar las facturas emitidas.
          </p>
        </div>
        {errors.criteria && (
          <div tabIndex={-1} data-criteria-error>
            <Notice
              variant="danger"
              title="Falta un criterio de búsqueda"
              description={errors.criteria}
            />
          </div>
        )}
        <div className={styles.fields}>
          {field('reservationRef', 'Reserva')}
          {field('stayId', 'Estancia (UUID)')}
          {field('customerName', 'Nombre del cliente')}
          {field(
            'customerMatch',
            'Coincidencia del nombre',
            <select
              id={`${id}-customerMatch`}
              className={styles.control}
              value={values.customerMatch}
              aria-invalid={!!errors.customerMatch}
              aria-describedby={
                errors.customerMatch ? `${id}-customerMatch-error` : `${id}-match-help`
              }
              onChange={(event) => onChange('customerMatch', event.target.value)}
            >
              <option value="EXACT">Exacta</option>
              <option value="PARTIAL">Parcial</option>
            </select>,
          )}
          {field('customerTaxId', 'Documento fiscal')}
          {field(
            'channel',
            'Canal',
            <select
              id={`${id}-channel`}
              className={styles.control}
              value={values.channel}
              aria-invalid={!!errors.channel}
              aria-describedby={errors.channel ? `${id}-channel-error` : undefined}
              onChange={(event) => onChange('channel', event.target.value)}
            >
              <option value="">Todos los canales</option>
              <option value="DIRECT">Directo</option>
              <option value="OTA">OTA</option>
            </select>,
          )}
          {field(
            'otaId',
            'Identificador OTA',
            <input
              id={`${id}-otaId`}
              className={styles.control}
              type="text"
              value={values.otaId}
              disabled={values.channel !== 'OTA'}
              onChange={(event) => onChange('otaId', event.target.value)}
              aria-invalid={!!errors.otaId}
              aria-describedby={errors.otaId ? `${id}-otaId-error` : undefined}
            />,
          )}
          {field('issuedFrom', 'Emitidas desde', undefined, 'date')}
          {field('issuedTo', 'Emitidas hasta', undefined, 'date')}
          {field(
            'pageSize',
            'Facturas por página',
            <select
              id={`${id}-pageSize`}
              className={styles.control}
              value={values.pageSize}
              aria-invalid={!!errors.pageSize}
              aria-describedby={errors.pageSize ? `${id}-pageSize-error` : undefined}
              onChange={(event) => onChange('pageSize', event.target.value)}
            >
              <option value="10">10</option>
              <option value="20">20</option>
              <option value="50">50</option>
              <option value="100">100</option>
            </select>,
          )}
        </div>
        <p id={`${id}-match-help`} className={styles.help}>
          El nombre exacto se compara completo; la coincidencia parcial requiere al menos 3
          caracteres. Las fechas de emisión incluyen ambos días y se interpretan en hora de
          Colombia.
        </p>
        <div className={styles.actions}>
          <Button variant="secondary" onClick={onClear}>
            Limpiar filtros
          </Button>
          <Button type="submit" aria-busy={busy}>
            Buscar facturas
          </Button>
        </div>
      </form>
    </Card>
  );
}
