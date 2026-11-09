// Feature 001 · Actualizar porcentaje de IVA
// "Historial" del diseño (FR-005, NFR-001, entidad "Historial de actualización de IVA").
import { VatRateChange } from '../../api/vatRate';
import { formatDateTime, formatPercent } from '../../lib/format';
import styles from './VatRatePage.module.css';

export function VatHistoryTable({ history }: { history: VatRateChange[] }) {
  return (
    <section className={styles.history} aria-labelledby="iva-historial">
      <h2 id="iva-historial" className={styles.sectionTitle}>
        Historial
      </h2>
      <div className={styles.tableWrapper}>
        <table className={styles.table}>
          <colgroup>
            <col className={styles.colDate} />
            <col />
            <col />
            <col className={styles.colUser} />
          </colgroup>
          <thead>
            <tr>
              <th scope="col">Fecha</th>
              <th scope="col">Antes</th>
              <th scope="col">Después</th>
              <th scope="col">Por</th>
            </tr>
          </thead>
          <tbody>
            {history.length === 0 ? (
              <tr>
                <td colSpan={4} className={styles.emptyRow}>
                  Todavía no hay cambios registrados.
                </td>
              </tr>
            ) : (
              history.map((change) => (
                <tr key={`${change.changedAt}-${change.valueAfter}`}>
                  <td>{formatDateTime(change.changedAt)}</td>
                  <td className={change.valueBefore === null ? styles.initial : undefined}>
                    {change.valueBefore === null ? 'Inicial' : formatPercent(change.valueBefore)}
                  </td>
                  <td className={styles.after}>{formatPercent(change.valueAfter)}</td>
                  <td>{change.changedByUsername ?? 'Usuario desconocido'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
