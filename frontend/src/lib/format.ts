// Formatos de la interfaz, tal como aparecen en el diseño: "19 %", "01 ene 2026",
// "01 ene 2026 · 00:00". Las fechas se muestran en la hora del hotel (Colombia), sin
// depender de la zona horaria del navegador.

export const HOTEL_TIME_ZONE = 'America/Bogota';

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

const percentFormat = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 2 });

// Espacio no separable (U+00A0).
export const NBSP = String.fromCharCode(0xa0);

// "19.00" → "19 %", "16.50" → "16,5 %". Espacio no separable para que no se parta.
export function formatPercent(value: string): string {
  return `${percentFormat.format(Number(value))}${NBSP}%`;
}

interface DateParts {
  day: string;
  month: string;
  year: string;
  hour: string;
  minute: string;
}

const partsFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: HOTEL_TIME_ZONE,
  year: 'numeric',
  month: 'numeric',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

function dateParts(iso: string): DateParts {
  const parts = Object.fromEntries(
    partsFormat.formatToParts(new Date(iso)).map((part) => [part.type, part.value]),
  );
  return {
    day: parts.day,
    month: MONTHS[Number(parts.month) - 1],
    year: parts.year,
    hour: parts.hour,
    minute: parts.minute,
  };
}

// "01 ene 2026"
export function formatDate(iso: string): string {
  const { day, month, year } = dateParts(iso);
  return `${day} ${month} ${year}`;
}

// "01 ene 2026 · 00:00" (tabla de historial)
export function formatDateTime(iso: string): string {
  const { hour, minute } = dateParts(iso);
  return `${formatDate(iso)} · ${hour}:${minute}`;
}

// "23 sep 2026, 11:52" (aviso de porcentaje guardado)
export function formatDateTimeShort(iso: string): string {
  const { hour, minute } = dateParts(iso);
  return `${formatDate(iso)}, ${hour}:${minute}`;
}
