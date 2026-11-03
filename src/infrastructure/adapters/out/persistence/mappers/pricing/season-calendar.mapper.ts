// Feature 011 · Revisar temporada del año
import { CalendarDateRange } from '../../../../../../domain/model/pricing/calendar-date-range.vo';
import { CalendarDate } from '../../../../../../domain/model/pricing/calendar-date.vo';
import { SeasonCalendarRevision } from '../../../../../../domain/model/pricing/season-calendar';
import {
  CalendarEntryKind,
  SeasonCalendarEntry,
} from '../../../../../../domain/model/pricing/season-calendar-entry';

// Revisión unida a sus entradas (una fila por entrada; las columnas de entrada son null
// si la revisión no tiene entradas). Las fechas llegan como texto YYYY-MM-DD (to_char)
// para no pasar por `Date` ni por zonas horarias.
export interface CalendarRow {
  revision_id: string | null;
  year: number | null;
  revision: number | null;
  effective_at: Date | null;
  changed_by: string | null;
  changed_at: Date | null;
  entry_id: string | null;
  season_id: string | null;
  kind: string | null;
  start_date: string | null;
  end_date: string | null;
}

export class SeasonCalendarMapper {
  // Agrupa las filas por revisión, conservando el orden de la consulta.
  static toRevisions(rows: CalendarRow[]): SeasonCalendarRevision[] {
    const grouped = new Map<string, { head: CalendarRow; entries: SeasonCalendarEntry[] }>();
    for (const row of rows) {
      if (!row.revision_id) continue;
      let group = grouped.get(row.revision_id);
      if (!group) {
        group = { head: row, entries: [] };
        grouped.set(row.revision_id, group);
      }
      if (row.entry_id) {
        group.entries.push(SeasonCalendarMapper.toEntry(row));
      }
    }
    return [...grouped.values()].map(
      ({ head, entries }) =>
        new SeasonCalendarRevision(
          head.year!,
          head.revision!,
          head.effective_at!,
          head.changed_by!,
          head.changed_at!,
          entries,
        ),
    );
  }

  static toEntry(
    row: Pick<CalendarRow, 'entry_id' | 'season_id' | 'kind' | 'start_date' | 'end_date'>,
  ): SeasonCalendarEntry {
    return new SeasonCalendarEntry(
      row.entry_id!,
      row.season_id!,
      row.kind as CalendarEntryKind,
      CalendarDateRange.of(CalendarDate.of(row.start_date), CalendarDate.of(row.end_date)),
    );
  }
}
