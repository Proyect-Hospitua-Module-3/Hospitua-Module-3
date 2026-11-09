// Feature 011 · Revisar temporada del año
import { useEffect, useId, useRef } from 'react';
import type { CalendarEntryInput, CalendarSeason } from '../../api/seasonCalendar';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { formatPercent } from '../../lib/format';
import type { CalendarEntryErrors } from '../../lib/seasonCalendar';
import styles from './CalendarForms.module.css';

interface CalendarEntryFormProps {
  year: number;
  seasons: CalendarSeason[];
  values: CalendarEntryInput;
  errors: CalendarEntryErrors;
  editing: boolean;
  disabled: boolean;
  onChange(field: keyof CalendarEntryInput, value: string): void;
  onSubmit(): void;
  onCancel(): void;
}

export function CalendarEntryForm({ year, seasons, values, errors, editing, disabled, onChange, onSubmit, onCancel }: CalendarEntryFormProps) {
  const id = useId();
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (Object.values(errors).some(Boolean)) {
      formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
    }
  }, [errors]);
  const yearText = String(year).padStart(4, '0');
  const lastYearText = String(Math.min(year + 1, 9999)).padStart(4, '0');
  const exception = values.kind === 'EXCEPTION';
  const missingSeason = values.seasonId && !seasons.some((season) => season.seasonId === values.seasonId);

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
          <h2 id={`${id}-title`} className={styles.title}>{editing ? 'Editar asignación' : 'Nueva asignación'}</h2>
          <p className={styles.description}>Define un período base o una excepción puntual para {year}.</p>
        </div>
        <fieldset className={styles.entryFields} disabled={disabled} aria-label="Datos de la asignación">
          <div className={styles.field}>
            <label htmlFor={`${id}-season`}>Temporada</label>
            <select
              id={`${id}-season`} className={styles.control} value={values.seasonId}
              onChange={(event) => onChange('seasonId', event.target.value)}
              aria-invalid={!!errors.seasonId} aria-describedby={errors.seasonId ? `${id}-season-error` : undefined}
            >
              <option value="">Selecciona una temporada</option>
              {missingSeason && <option value={values.seasonId} disabled>Temporada no disponible</option>}
              {seasons.map((season) => (
                <option key={season.seasonId} value={season.seasonId}>
                  {season.name ?? 'Temporada no disponible'}
                  {season.adjustmentPercent !== null ? ` (${Number(season.adjustmentPercent) > 0 ? '+' : ''}${formatPercent(season.adjustmentPercent)})` : ''}
                </option>
              ))}
            </select>
            {errors.seasonId && <p id={`${id}-season-error`} className={styles.error} role="alert">{errors.seasonId}</p>}
          </div>
          <div className={styles.field}>
            <label htmlFor={`${id}-kind`}>Tipo de asignación</label>
            <select
              id={`${id}-kind`} className={styles.control} value={values.kind}
              onChange={(event) => onChange('kind', event.target.value)}
              aria-invalid={!!errors.kind} aria-describedby={errors.kind ? `${id}-kind-error` : `${id}-kind-help`}
            >
              <option value="BASE">Período base</option>
              <option value="EXCEPTION">Excepción de un día</option>
            </select>
            <p id={`${id}-kind-help`} className={styles.help}>{exception ? 'La excepción prevalece sobre el período base de ese día.' : 'Un período base puede continuar hasta el año siguiente.'}</p>
            {errors.kind && <p id={`${id}-kind-error`} className={styles.error} role="alert">{errors.kind}</p>}
          </div>
          <div className={styles.field}>
            <label htmlFor={`${id}-start`}>Fecha de inicio</label>
            <input
              id={`${id}-start`} className={styles.control} type="date"
              min={`${yearText}-01-01`} max={`${yearText}-12-31`}
              value={values.startDate} onChange={(event) => onChange('startDate', event.target.value)}
              aria-invalid={!!errors.startDate} aria-describedby={errors.startDate ? `${id}-start-error` : `${id}-dates-help`}
            />
            {errors.startDate && <p id={`${id}-start-error`} className={styles.error} role="alert">{errors.startDate}</p>}
          </div>
          <div className={styles.field}>
            <label htmlFor={`${id}-end`}>Fecha de fin</label>
            <input
              id={`${id}-end`} className={styles.control} type="date"
              min={values.startDate || `${yearText}-01-01`}
              max={exception ? values.startDate || `${yearText}-12-31` : `${lastYearText}-12-31`}
              readOnly={exception}
              value={values.endDate} onChange={(event) => onChange('endDate', event.target.value)}
              aria-invalid={!!errors.endDate} aria-describedby={errors.endDate ? `${id}-end-error` : `${id}-dates-help`}
            />
            {errors.endDate && <p id={`${id}-end-error`} className={styles.error} role="alert">{errors.endDate}</p>}
          </div>
          <p id={`${id}-dates-help`} className={`${styles.help} ${styles.fullWidth}`}>
            {exception ? 'Una excepción cubre solo la fecha de inicio; la fecha de fin se actualiza automáticamente.' : 'Las fechas de inicio y fin están incluidas en la asignación.'}
          </p>
          <div className={`${styles.actions} ${styles.fullWidth}`}>
            <Button variant="secondary" disabled={disabled} onClick={onCancel}>{editing ? 'Cancelar edición' : 'Limpiar asignación'}</Button>
            <Button type="submit" disabled={disabled || seasons.length === 0}>{editing ? 'Guardar asignación' : 'Agregar asignación'}</Button>
          </div>
        </fieldset>
        <p className={styles.help}>Las asignaciones quedan en el borrador hasta que publiques el calendario.</p>
      </form>
    </Card>
  );
}
