import { CalendarSeason } from '../../api/seasonCalendar';
import { formatPercent } from '../../lib/format';
import styles from './CalendarView.module.css';

interface CalendarLegendProps {
  seasons: CalendarSeason[];
}

export function CalendarLegend({ seasons }: CalendarLegendProps) {
  const uniqueSeasons = [...new Map(seasons.map((season) => [season.seasonId, season])).values()];

  return (
    <section className={styles.legend} aria-label="Leyenda del calendario">
      <ul className={styles.seasonLegend}>
        {uniqueSeasons.map((season) => (
          <li key={season.seasonId} className={styles.legendSeason}>
            <span
              className={styles.colorDot}
              style={{
                backgroundColor:
                  season.color && /^#[0-9a-f]{6}$/i.test(season.color) ? season.color : '#8e9097',
              }}
              aria-hidden="true"
            />
            <span className={styles.legendName}>{season.name ?? 'Temporada no disponible'}</span>
            <span className={styles.muted}>
              {season.adjustmentPercent === null
                ? 'Ajuste no disponible'
                : `${Number(season.adjustmentPercent) > 0 ? '+' : ''}${formatPercent(season.adjustmentPercent)}`}
            </span>
          </li>
        ))}
      </ul>
      <ul className={styles.sourceLegend}>
        <li>
          <span className={styles.sourceSymbol} aria-hidden="true">P</span>
          Período base
        </li>
        <li>
          <span className={`${styles.sourceSymbol} ${styles.exceptionSymbol}`} aria-hidden="true">
            E
          </span>
          Excepción de un día
        </li>
        <li>
          <span className={`${styles.sourceSymbol} ${styles.defaultSymbol}`} aria-hidden="true">
            D
          </span>
          Predeterminada (DEFAULT)
        </li>
        <li>
          <span className={`${styles.sourceSymbol} ${styles.conflictSymbol}`} aria-hidden="true">
            !
          </span>
          Conflicto
        </li>
      </ul>
      <p className={styles.help}>
        La excepción prevalece sobre el período base. Sin asignación explícita se aplica la temporada
        predeterminada. Un conflicto debe resolverse antes de publicar.
      </p>
    </section>
  );
}
