// Feature 009 · Modificar precio tarifa según temporada
import { SeasonRule } from '../../api/seasonRules';
import { Button } from '../../components/ui/Button';
import { StatusPill } from '../../components/ui/StatusPill';
import { formatDateTime, formatPercent } from '../../lib/format';
import styles from './SeasonRulesPage.module.css';

interface SeasonRulesTableProps {
  seasons: SeasonRule[];
  selectedId: string | undefined;
  disabled: boolean;
  currentUserId: string | undefined;
  currentUsername: string | undefined;
  onCreate(): void;
  onEdit(season: SeasonRule): void;
  onRetire(season: SeasonRule): void;
}

export function SeasonRulesTable({
  seasons,
  selectedId,
  disabled,
  currentUserId,
  currentUsername,
  onCreate,
  onEdit,
  onRetire,
}: SeasonRulesTableProps) {
  return (
    <section className={styles.catalog} aria-labelledby="season-catalog-title">
      <div className={styles.catalogHeader}>
        <div>
          <h2 id="season-catalog-title" className={styles.sectionTitle}>
            Catálogo de temporadas
          </h2>
          <p className={styles.muted}>
            {seasons.length}{' '}
            {seasons.length === 1 ? 'temporada configurada' : 'temporadas configuradas'}
          </p>
        </div>
        <Button onClick={onCreate} disabled={disabled}>
          Nueva temporada
        </Button>
      </div>
      <div
        className={styles.tableWrapper}
        tabIndex={0}
        role="region"
        aria-label="Listado de temporadas"
      >
        <table className={styles.table} aria-label="Catálogo de temporadas">
          <thead>
            <tr>
              <th scope="col">Temporada</th>
              <th scope="col">Color</th>
              <th scope="col">Ajuste</th>
              <th scope="col">Último cambio</th>
              <th scope="col">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {seasons.map((season) => (
              <tr
                key={season.seasonId}
                className={selectedId === season.seasonId ? styles.selectedRow : undefined}
              >
                <th scope="row">
                  <div className={styles.seasonName}>{season.name}</div>
                  {season.isDefault && <StatusPill label="Predeterminada" />}
                </th>
                <td>
                  <span className={styles.colorValue}>
                    <span
                      className={styles.colorDot}
                      style={{ backgroundColor: season.color }}
                      aria-hidden="true"
                    />
                    {season.color}
                  </span>
                </td>
                <td>
                  <span className={styles.adjustment}>
                    {Number(season.adjustmentPercent) > 0 ? '+' : ''}
                    {formatPercent(season.adjustmentPercent)}
                  </span>
                  <span className={styles.cellMeta}>
                    {Number(season.adjustmentPercent) > 0
                      ? 'Incremento'
                      : Number(season.adjustmentPercent) < 0
                        ? 'Descuento'
                        : 'Sin ajuste'}
                  </span>
                </td>
                <td>
                  <span>{formatDateTime(season.updatedAt)}</span>
                  <span className={`${styles.cellMeta} ${styles.actor}`} title={season.updatedBy}>
                    {season.updatedBy === currentUserId && currentUsername
                      ? currentUsername
                      : season.updatedBy}
                  </span>
                </td>
                <td>
                  <div className={styles.rowActions}>
                    <Button
                      variant="secondary"
                      aria-label={`Editar ${season.name}`}
                      onClick={() => onEdit(season)}
                      disabled={disabled}
                    >
                      Editar
                    </Button>
                    {!season.isDefault && (
                      <Button
                        variant="secondary"
                        className={styles.retireButton}
                        aria-label={`Retirar ${season.name}`}
                        onClick={() => onRetire(season)}
                        disabled={disabled}
                      >
                        Retirar
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {seasons.length === 0 && (
              <tr>
                <td colSpan={5} className={styles.emptyRow}>
                  No hay temporadas disponibles en el catálogo.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className={styles.help}>
        Un ajuste positivo incrementa la tarifa base; uno negativo aplica un descuento. El retiro
        conserva el historial.
      </p>
    </section>
  );
}
