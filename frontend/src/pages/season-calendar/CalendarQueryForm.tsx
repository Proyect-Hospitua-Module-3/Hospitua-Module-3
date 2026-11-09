// Feature 011 · Revisar temporada del año
import { useEffect, useId, useRef } from 'react';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import type { CalendarQueryErrors, CalendarQueryInput } from '../../lib/seasonCalendar';
import styles from './CalendarForms.module.css';

interface CalendarQueryFormProps {
  values: CalendarQueryInput;
  errors: CalendarQueryErrors;
  disabled: boolean;
  onChange(field: keyof CalendarQueryInput, value: string): void;
  onSubmit(): void;
}

export function CalendarQueryForm({ values, errors, disabled, onChange, onSubmit }: CalendarQueryFormProps) {
  const id = useId();
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (Object.values(errors).some(Boolean)) {
      formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
    }
  }, [errors]);
  const validYear = /^\d{1,4}$/.test(values.year) && Number(values.year) >= 1;
  const year = validYear ? values.year.padStart(4, '0') : undefined;

  return (
    <Card className={styles.card} aria-labelledby={`${id}-title`}>
      <form
        ref={formRef}
        className={styles.form}
        aria-labelledby={`${id}-title`}
        noValidate
        onSubmit={(event) => { event.preventDefault(); if (!disabled) onSubmit(); }}
      >
        <div>
          <h2 id={`${id}-title`} className={styles.title}>Consultar calendario</h2>
          <p className={styles.description}>Consulta un año completo, un rango de fechas o una publicación anterior.</p>
        </div>
        <fieldset className={styles.queryFields} disabled={disabled} aria-label="Filtros del calendario">
          <div className={styles.field}>
            <label htmlFor={`${id}-year`}>Año</label>
            <input
              id={`${id}-year`} className={styles.control} type="number" min="1" max="9999" step="1"
              value={values.year} onChange={(event) => onChange('year', event.target.value)}
              aria-invalid={!!errors.year} aria-describedby={errors.year ? `${id}-year-error` : undefined}
            />
            {errors.year && <p id={`${id}-year-error`} className={styles.error} role="alert">{errors.year}</p>}
          </div>
          <div className={styles.field}>
            <label htmlFor={`${id}-from`}>Desde</label>
            <input
              id={`${id}-from`} className={styles.control} type="date"
              min={year ? `${year}-01-01` : '0001-01-01'} max={year ? `${year}-12-31` : '9999-12-31'}
              value={values.from} onChange={(event) => onChange('from', event.target.value)}
              aria-invalid={!!errors.from} aria-describedby={errors.from ? `${id}-from-error` : `${id}-range-help`}
            />
            {errors.from && <p id={`${id}-from-error`} className={styles.error} role="alert">{errors.from}</p>}
          </div>
          <div className={styles.field}>
            <label htmlFor={`${id}-to`}>Hasta</label>
            <input
              id={`${id}-to`} className={styles.control} type="date"
              min={year ? `${year}-01-01` : '0001-01-01'} max={year ? `${year}-12-31` : '9999-12-31'}
              value={values.to} onChange={(event) => onChange('to', event.target.value)}
              aria-invalid={!!errors.to} aria-describedby={errors.to ? `${id}-to-error` : `${id}-range-help`}
            />
            {errors.to && <p id={`${id}-to-error`} className={styles.error} role="alert">{errors.to}</p>}
          </div>
          <div className={styles.field}>
            <label htmlFor={`${id}-mode`}>Consulta</label>
            <select id={`${id}-mode`} className={styles.control} value={values.mode} onChange={(event) => onChange('mode', event.target.value)}>
              <option value="current">Vigente</option>
              <option value="revision">Por revisión</option>
              <option value="asOf">En una fecha y hora</option>
            </select>
          </div>
          {values.mode === 'revision' && (
            <div className={styles.field}>
              <label htmlFor={`${id}-revision`}>Revisión</label>
              <input
                id={`${id}-revision`} className={styles.control} type="number" min="1" max="999999999" step="1"
                value={values.revision} onChange={(event) => onChange('revision', event.target.value)}
                aria-invalid={!!errors.revision} aria-describedby={errors.revision ? `${id}-revision-error` : undefined}
              />
              {errors.revision && <p id={`${id}-revision-error`} className={styles.error} role="alert">{errors.revision}</p>}
            </div>
          )}
          {values.mode === 'asOf' && (
            <div className={`${styles.field} ${styles.instantField}`}>
              <label htmlFor={`${id}-asOf`}>Fecha y hora (Colombia)</label>
              <input
                id={`${id}-asOf`} className={styles.control} type="datetime-local" step="1"
                min="0001-01-01T00:00:00" max="9999-12-31T18:59:59"
                value={values.asOf} onChange={(event) => onChange('asOf', event.target.value)}
                aria-invalid={!!errors.asOf} aria-describedby={errors.asOf ? `${id}-asOf-error` : `${id}-instant-help`}
              />
              <p id={`${id}-instant-help`} className={styles.help}>Hora del hotel: America/Bogota (UTC−05:00).</p>
              {errors.asOf && <p id={`${id}-asOf-error`} className={styles.error} role="alert">{errors.asOf}</p>}
            </div>
          )}
          <div className={styles.queryAction}>
            <Button type="submit" disabled={disabled}>Consultar calendario</Button>
          </div>
        </fieldset>
        <p id={`${id}-range-help`} className={styles.help}>Deja ambas fechas vacías para consultar todo el año. Las consultas históricas son de solo lectura.</p>
      </form>
    </Card>
  );
}
