// Feature 001 · Actualizar porcentaje de IVA
// Tarjeta "Actualizar porcentaje" del diseño (HU1, FR-001, FR-002, FR-004, BR-002, NFR-004).
import { FormEvent, useId } from 'react';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Notice, NoticeVariant } from '../../components/ui/Notice';
import styles from './VatRatePage.module.css';

export interface FormNotice {
  variant: NoticeVariant;
  title: string;
  description?: string;
}

// Aviso por defecto: un cambio nunca alcanza facturas ya emitidas (HU2, BR-002).
const NEW_INVOICES_ONLY: FormNotice = {
  variant: 'info',
  title: 'Solo para facturas nuevas',
  description: 'Las facturas ya emitidas conservan su IVA y su total.',
};

interface UpdateVatFormProps {
  value: string;
  fieldError: string | null;
  // Resultado del último intento; sin él se muestra el aviso por defecto.
  notice: FormNotice | null;
  saving: boolean;
  onChange(value: string): void;
  onSubmit(): void;
  onCancel(): void;
}

export function UpdateVatForm({
  value,
  fieldError,
  notice,
  saving,
  onChange,
  onSubmit,
  onCancel,
}: UpdateVatFormProps) {
  const inputId = useId();
  const errorId = useId();
  const shown = notice ?? NEW_INVOICES_ONLY;

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    onSubmit();
  }

  const inputClass = [
    styles.inputBox,
    value !== '' ? styles.inputFilled : '',
    fieldError ? styles.inputInvalid : '',
  ].join(' ');

  return (
    <Card className={styles.updateCard} aria-labelledby={`${inputId}-title`}>
      <form className={styles.form} onSubmit={handleSubmit} noValidate>
        <p id={`${inputId}-title`} className={styles.sectionTitle}>
          Actualizar porcentaje
        </p>

        <div className={styles.field}>
          <label htmlFor={inputId} className={styles.fieldLabel}>
            Nuevo porcentaje
          </label>
          <div className={inputClass}>
            <input
              id={inputId}
              className={styles.input}
              inputMode="decimal"
              autoComplete="off"
              value={value}
              onChange={(event) => onChange(event.target.value)}
              aria-invalid={fieldError ? true : undefined}
              aria-describedby={fieldError ? errorId : undefined}
            />
            <span className={styles.inputSuffix} aria-hidden="true">
              %
            </span>
          </div>
          {fieldError && (
            <p id={errorId} className={styles.fieldError}>
              {fieldError}
            </p>
          )}
        </div>

        <Notice variant={shown.variant} title={shown.title} description={shown.description} />

        <div className={styles.actions}>
          <Button variant="secondary" onClick={onCancel} disabled={saving}>
            Cancelar
          </Button>
          <Button type="submit" disabled={saving || value.trim() === ''}>
            {saving ? 'Guardando…' : 'Guardar'}
          </Button>
        </div>
      </form>
    </Card>
  );
}
