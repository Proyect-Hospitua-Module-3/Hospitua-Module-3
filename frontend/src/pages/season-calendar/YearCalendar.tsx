import { CSSProperties, KeyboardEvent, useRef } from 'react';
import {
  CalendarConflict,
  CalendarEntry,
  CalendarSeason,
  CarriedInEntry,
} from '../../api/seasonCalendar';
import { Card } from '../../components/ui/Card';
import { formatPercent } from '../../lib/format';
import {
  calendarMonthDays,
  calendarWeekday,
  formatCalendarDate,
  resolveCalendarDate,
} from '../../lib/seasonCalendar';
import styles from './CalendarView.module.css';

interface YearCalendarProps {
  year: number;
  entries: CalendarEntry[];
  carriedInEntries: CarriedInEntry[];
  defaultSeason: CalendarSeason;
  conflicts: CalendarConflict[];
  from?: string;
  to?: string;
  selectedDate: string;
  onSelectDate(date: string): void;
}

const MONTHS = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
];

const WEEKDAYS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
const SOURCE_LABELS = {
  BASE: 'Período base',
  EXCEPTION: 'Excepción',
  DEFAULT: 'Predeterminada (DEFAULT)',
  CONFLICT: 'Conflicto',
};
const SOURCE_SYMBOLS = { BASE: 'P', EXCEPTION: 'E', DEFAULT: 'D', CONFLICT: '!' };

export function YearCalendar({
  year,
  entries,
  carriedInEntries,
  defaultSeason,
  conflicts,
  from,
  to,
  selectedDate,
  onSelectDate,
}: YearCalendarProps) {
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const months = MONTHS.map((name, index) => ({ name, days: calendarMonthDays(year, index + 1) }));
  const availableDays = months
    .flatMap((month) => month.days)
    .filter((date) => (!from || date >= from) && (!to || date <= to));
  const focusDate = availableDays.includes(selectedDate) ? selectedDate : availableDays[0];

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, date: string) {
    const index = availableDays.indexOf(date);
    let nextIndex: number;
    switch (event.key) {
      case 'ArrowLeft':
        nextIndex = index - 1;
        break;
      case 'ArrowRight':
        nextIndex = index + 1;
        break;
      case 'ArrowUp':
        nextIndex = index - 7;
        break;
      case 'ArrowDown':
        nextIndex = index + 7;
        break;
      case 'Home':
        nextIndex = index - calendarWeekday(date);
        break;
      case 'End':
        nextIndex = index + 6 - calendarWeekday(date);
        break;
      default:
        return;
    }
    event.preventDefault();
    const nextDate = availableDays[Math.max(0, Math.min(availableDays.length - 1, nextIndex))];
    if (nextDate) {
      onSelectDate(nextDate);
      buttons.current.get(nextDate)?.focus();
    }
  }

  return (
    <section className={styles.calendar} aria-label={`Calendario de temporadas ${year}`}>
      <p className={styles.help}>
        Selecciona un día para consultar su temporada y ajuste. Con el teclado, usa las flechas para
        recorrer las fechas; Inicio y Fin recorren la semana.
      </p>
      <div className={styles.months}>
        {months.map(({ name, days }, monthIndex) => (
          <Card
            key={name}
            className={styles.month}
            aria-labelledby={`calendar-month-${year}-${monthIndex}`}
          >
            <h3 id={`calendar-month-${year}-${monthIndex}`} className={styles.monthTitle}>
              {name}
              <span>{year}</span>
            </h3>
            <div className={styles.weekdays} aria-hidden="true">
              {WEEKDAYS.map((weekday, index) => <span key={index}>{weekday}</span>)}
            </div>
            <div className={styles.days}>
              {Array.from({ length: calendarWeekday(days[0]) }, (_, index) => (
                <span key={`empty-${index}`} aria-hidden="true" />
              ))}
              {days.map((date) => {
                const day = resolveCalendarDate(
                  date,
                  entries,
                  carriedInEntries,
                  defaultSeason,
                  conflicts,
                );
                const outsideWindow = Boolean((from && date < from) || (to && date > to));
                const color =
                  day.season?.color && /^#[0-9a-f]{6}$/i.test(day.season.color)
                    ? day.season.color
                    : '#8e9097';
                const adjustment =
                  day.season?.adjustmentPercent != null
                    ? `, ajuste ${Number(day.season.adjustmentPercent) > 0 ? '+' : ''}${formatPercent(day.season.adjustmentPercent)}`
                    : '';
                const label = `${formatCalendarDate(date)}: ${SOURCE_LABELS[day.source]}${
                  day.inherited ? ' heredado del año anterior' : ''
                }${day.season ? `, ${day.season.name ?? 'Temporada no disponible'}${adjustment}` : ''}${
                  outsideWindow ? ', fuera del rango consultado' : ''
                }`;
                const dayStyle = {
                  '--day-color': color,
                  '--day-background': `${color}18`,
                } as CSSProperties;

                return (
                  <button
                    key={date}
                    type="button"
                    ref={(element) => {
                      if (element) buttons.current.set(date, element);
                      else buttons.current.delete(date);
                    }}
                    className={styles.day}
                    style={dayStyle}
                    data-source={day.source}
                    data-date={date}
                    aria-label={label}
                    aria-pressed={selectedDate === date}
                    title={label}
                    disabled={outsideWindow}
                    tabIndex={date === focusDate ? 0 : -1}
                    onClick={() => onSelectDate(date)}
                    onKeyDown={(event) => handleKeyDown(event, date)}
                  >
                    <span className={styles.dayNumber}>{Number(date.slice(-2))}</span>
                    <span className={styles.daySource} aria-hidden="true">
                      {SOURCE_SYMBOLS[day.source]}
                    </span>
                  </button>
                );
              })}
            </div>
          </Card>
        ))}
      </div>
    </section>
  );
}
