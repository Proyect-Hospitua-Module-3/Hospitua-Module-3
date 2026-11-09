// Feature 009 · Modificar precio tarifa según temporada
import { SeasonRule } from '../../api/seasonRules';
import { Card } from '../../components/ui/Card';
import { StatusPill } from '../../components/ui/StatusPill';
import { formatDateTime, formatPercent } from '../../lib/format';
import styles from './SeasonRulesPage.module.css';

export function DefaultSeasonCard({ season }: { season: SeasonRule | undefined }) {
  return (
    <Card className={styles.defaultCard} aria-label="Temporada predeterminada">
      <div className={styles.cardHeader}>
        <h2 className={styles.currentLabel}>Temporada predeterminada</h2>
        <StatusPill label="Predeterminada" />
      </div>
      {season ? (
        <>
          <p className={styles.defaultName}>
            <span
              className={styles.colorDot}
              style={{ backgroundColor: season.color }}
              aria-hidden="true"
            />
            {season.name}
          </p>
          <p className={styles.currentValue}>
            {Number(season.adjustmentPercent) > 0 ? '+' : ''}
            {formatPercent(season.adjustmentPercent)}
          </p>
          <p className={styles.muted}>sobre la tarifa base</p>
          <p className={styles.defaultDescription}>
            Se aplica a las fechas sin una temporada asignada en el calendario.
          </p>
          <p className={styles.help}>Último cambio: {formatDateTime(season.updatedAt)}</p>
        </>
      ) : (
        <p className={styles.muted}>
          No hay una temporada predeterminada disponible. Actualiza el catálogo.
        </p>
      )}
    </Card>
  );
}
