// Feature 009 · Modificar precio tarifa según temporada
import { FormEvent, useId } from 'react';
import { SeasonRule, SeasonRuleInput } from '../../api/seasonRules';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Notice, NoticeVariant } from '../../components/ui/Notice';
import { SEASON_NAME_MAX_LENGTH, SeasonInputErrors } from '../../lib/seasonInput';
import styles from './SeasonRulesPage.module.css';

export interface SeasonNotice {
  variant: NoticeVariant;
  title: string;
  description?: string;
}

interface SeasonFormProps {
  season: SeasonRule | null;
  values: SeasonRuleInput;
  errors: SeasonInputErrors;
  notice: SeasonNotice | null;
  busy: boolean;
  saving: boolean;
  onChange(field: keyof SeasonRuleInput, value: string): void;
  onSubmit(): void;
  onCancel(): void;
}

export function SeasonForm({
  season,
  values,
  errors,
  notice,
  busy,
  saving,
  onChange,
  onSubmit,
  onCancel,
}: SeasonFormProps) {
  const id = useId();
  const title = season ? 'Editar temporada' : 'Nueva temporada';

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    onSubmit();
  }

  return (
    <Card className={styles.formCard} aria-labelledby={`${id}-title`}>
      <form className={styles.form} onSubmit={handleSubmit} noValidate>
        <div>
          <h2 id={`${id}-title`} className={styles.sectionTitle}>
            {title}
          </h2>
          <p className={styles.muted}>
            {season
              ? `Actualiza los datos de ${season.name}.`
              : 'Agrega una temporada al catálogo del hotel.'}
          </p>
        </div>

        <div className={styles.field}>
          <label htmlFor={`${id}-name`} className={styles.fieldLabel}>
            Nombre
          </label>
          <input
            id={`${id}-name`}
            className={styles.textInput}
            value={values.name}
            maxLength={SEASON_NAME_MAX_LENGTH}
            autoComplete="off"
            disabled={busy || season?.isDefault}
            onChange={(event) => onChange('name', event.target.value)}
            aria-invalid={!!errors.name}
            aria-describedby={
              errors.name ? `${id}-name-error` : season?.isDefault ? `${id}-default` : undefined
            }
          />
          {season?.isDefault && (
            <p id={`${id}-default`} className={styles.help}>
              Regular conserva su nombre. Puedes cambiar su color y ajuste.
            </p>
          )}
          {errors.name && (
            <p id={`${id}-name-error`} className={styles.fieldError}>
              {errors.name}
            </p>
          )}
        </div>

        <div className={styles.fieldRow}>
          <div className={styles.field}>
            <label htmlFor={`${id}-color`} className={styles.fieldLabel}>
              Color hexadecimal
            </label>
            <div className={styles.colorInputs}>
              <input
                type="color"
                className={styles.colorPicker}
                aria-label="Elegir color"
                value={/^#[0-9a-f]{6}$/i.test(values.color) ? values.color : '#808080'}
                disabled={busy}
                onChange={(event) => onChange('color', event.target.value.toUpperCase())}
              />
              <input
                id={`${id}-color`}
                className={`${styles.textInput} ${styles.hexInput}`}
                value={values.color}
                autoComplete="off"
                spellCheck={false}
                disabled={busy}
                onChange={(event) => onChange('color', event.target.value)}
                aria-invalid={!!errors.color}
                aria-describedby={errors.color ? `${id}-color-error` : `${id}-color-help`}
              />
            </div>
            <p id={`${id}-color-help`} className={styles.help}>
              Formato #RRGGBB.
            </p>
            {errors.color && (
              <p id={`${id}-color-error`} className={styles.fieldError}>
                {errors.color}
              </p>
            )}
          </div>

          <div className={styles.field}>
            <label htmlFor={`${id}-adjustment`} className={styles.fieldLabel}>
              Ajuste porcentual
            </label>
            <div className={styles.percentInput} data-invalid={!!errors.adjustmentPercent}>
              <input
                id={`${id}-adjustment`}
                value={values.adjustmentPercent}
                inputMode="decimal"
                autoComplete="off"
                disabled={busy}
                onChange={(event) => onChange('adjustmentPercent', event.target.value)}
                aria-invalid={!!errors.adjustmentPercent}
                aria-describedby={
                  errors.adjustmentPercent ? `${id}-adjustment-error` : `${id}-adjustment-help`
                }
              />
              <span aria-hidden="true">%</span>
            </div>
            <p id={`${id}-adjustment-help`} className={styles.help}>
              De −100 a +100, hasta dos decimales.
            </p>
            {errors.adjustmentPercent && (
              <p id={`${id}-adjustment-error`} className={styles.fieldError}>
                {errors.adjustmentPercent}
              </p>
            )}
          </div>
        </div>

        <Notice
          variant={notice?.variant ?? 'info'}
          title={notice?.title ?? 'Solo para nuevas cotizaciones'}
          description={
            notice?.description ??
            'Las cotizaciones, liquidaciones y facturas existentes conservan sus valores.'
          }
        />
        <div className={styles.actions}>
          <Button variant="secondary" onClick={onCancel} disabled={busy}>
            Cancelar
          </Button>
          <Button type="submit" disabled={busy}>
            {saving ? 'Guardando…' : 'Guardar'}
          </Button>
        </div>
      </form>
    </Card>
  );
}
