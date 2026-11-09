import { CalendarEntry, CarriedInEntry } from '../../api/seasonCalendar';
import { Button } from '../../components/ui/Button';
import { formatPercent } from '../../lib/format';
import { formatCalendarDate } from '../../lib/seasonCalendar';
import styles from './CalendarView.module.css';

interface CalendarEntriesTableProps {
  entries: CalendarEntry[];
  carriedInEntries: CarriedInEntry[];
  readOnly: boolean;
  disabled: boolean;
  onEdit(entryId: string): void;
  onRemove(entryId: string): void;
  onOpenYear?(year: number): void;
}

function SeasonCell({ entry }: { entry: CalendarEntry }) {
  return (
    <>
      <span className={styles.tableSeason}>
        <span
          className={styles.colorDot}
          style={{
            backgroundColor:
              entry.season.color && /^#[0-9a-f]{6}$/i.test(entry.season.color)
                ? entry.season.color
                : '#8e9097',
          }}
          aria-hidden="true"
        />
        {entry.season.name ?? 'Temporada no disponible'}
      </span>
      <span className={styles.cellMeta}>
        {entry.season.adjustmentPercent === null
          ? 'Ajuste no disponible'
          : `${Number(entry.season.adjustmentPercent) > 0 ? '+' : ''}${formatPercent(entry.season.adjustmentPercent)}`}
      </span>
    </>
  );
}

function sortedEntries<T extends CalendarEntry>(entries: T[]): T[] {
  return [...entries].sort(
    (left, right) => left.startDate.localeCompare(right.startDate) || left.kind.localeCompare(right.kind),
  );
}

export function CalendarEntriesTable({
  entries,
  carriedInEntries,
  readOnly,
  disabled,
  onEdit,
  onRemove,
  onOpenYear,
}: CalendarEntriesTableProps) {
  return (
    <div className={styles.entrySections}>
      <section className={styles.entrySection} aria-labelledby="calendar-entries-title">
        <div>
          <h2 id="calendar-entries-title" className={styles.sectionTitle}>
            Períodos y excepciones del año
          </h2>
          <p className={styles.muted}>
            {entries.length} {entries.length === 1 ? 'asignación propia' : 'asignaciones propias'}.
            Se muestran todas, incluso las que quedan fuera del rango consultado.
          </p>
        </div>
        <div className={styles.tableWrapper} tabIndex={0} role="region" aria-label="Asignaciones del año">
          <table className={styles.table} aria-label="Períodos y excepciones del año">
            <thead>
              <tr>
                <th scope="col">Temporada</th>
                <th scope="col">Tipo</th>
                <th scope="col">Desde</th>
                <th scope="col">Hasta</th>
                {!readOnly && <th scope="col">Acciones</th>}
              </tr>
            </thead>
            <tbody>
              {sortedEntries(entries).map((entry) => (
                <tr key={entry.entryId}>
                  <th scope="row"><SeasonCell entry={entry} /></th>
                  <td>{entry.kind === 'BASE' ? 'Período base' : 'Excepción'}</td>
                  <td className={styles.dateCell}>{formatCalendarDate(entry.startDate)}</td>
                  <td className={styles.dateCell}>{formatCalendarDate(entry.endDate)}</td>
                  {!readOnly && (
                    <td>
                      <div className={styles.rowActions}>
                        <Button
                          variant="secondary"
                          disabled={disabled}
                          onClick={() => onEdit(entry.entryId)}
                          aria-label={`Editar ${entry.kind === 'BASE' ? 'período' : 'excepción'} ${entry.startDate}`}
                        >
                          Editar
                        </Button>
                        <Button
                          variant="secondary"
                          className={styles.removeButton}
                          disabled={disabled}
                          onClick={() => onRemove(entry.entryId)}
                          aria-label={`Quitar ${entry.kind === 'BASE' ? 'período' : 'excepción'} ${entry.startDate}`}
                        >
                          Quitar
                        </Button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
              {entries.length === 0 && (
                <tr>
                  <td colSpan={readOnly ? 4 : 5} className={styles.emptyRow}>
                    No hay asignaciones propias. Se aplican los períodos heredados y la temporada
                    predeterminada en las demás fechas.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className={styles.help}>
          Las fechas de inicio y fin están incluidas. Cada período pertenece al año en que comienza y
          puede terminar en el siguiente. La publicación guarda todas las asignaciones propias del año.
        </p>
      </section>

      <section className={styles.entrySection} aria-labelledby="calendar-inherited-title">
        <div>
          <h2 id="calendar-inherited-title" className={styles.sectionTitle}>Períodos heredados</h2>
          <p className={styles.muted}>
            Comienzan en el año anterior y continúan en este. Se consultan aquí y se modifican desde su
            año de origen.
          </p>
        </div>
        {carriedInEntries.length > 0 ? (
          <div className={styles.tableWrapper} tabIndex={0} role="region" aria-label="Períodos heredados">
            <table className={styles.table} aria-label="Períodos heredados del año anterior">
              <thead>
                <tr>
                  <th scope="col">Temporada</th>
                  <th scope="col">Desde</th>
                  <th scope="col">Hasta</th>
                  <th scope="col">Origen</th>
                </tr>
              </thead>
              <tbody>
                {sortedEntries(carriedInEntries).map((entry) => (
                  <tr key={`${entry.ownerYear}-${entry.entryId}`}>
                    <th scope="row"><SeasonCell entry={entry} /></th>
                    <td className={styles.dateCell}>{formatCalendarDate(entry.startDate)}</td>
                    <td className={styles.dateCell}>{formatCalendarDate(entry.endDate)}</td>
                    <td>
                      {onOpenYear ? (
                        <Button
                          variant="secondary"
                          disabled={disabled}
                          aria-label={`Abrir calendario ${entry.ownerYear}`}
                          onClick={() => onOpenYear(entry.ownerYear)}
                        >
                          Calendario {entry.ownerYear}
                        </Button>
                      ) : <span>Calendario {entry.ownerYear}</span>}
                      <span className={styles.cellMeta}>
                        Revisión {entry.ownerRevision} · Solo lectura
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className={styles.emptyInherited}>No hay períodos heredados del año anterior.</p>}
      </section>
    </div>
  );
}
