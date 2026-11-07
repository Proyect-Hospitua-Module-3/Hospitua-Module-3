// Feature 010 · Registrar Check-out
import { InvalidCheckoutEventError } from '../../errors/checkout-ingestion/invalid-checkout-event.error';

export const CHECK_OUT_EVENT_TYPE = 'CHECK_OUT';
export const MODULE_1_SOURCE = 'MODULE_1';

// UUID 8-4-4-4-12 hexadecimal, sin exigir versión ni variante (igual que en 004).
const UUID_FORMAT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_FORMAT = /^(\d{4})-(\d{2})-(\d{2})$/;
// ISO 8601 con offset obligatorio (`Z` o `±HH:MM`); segundos y fracción opcionales.
// Módulo 1 envía `-05:00` y puede incluir microsegundos.
const INSTANT_FORMAT =
  /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(?:Z|[+-](\d{2}):(\d{2}))$/;

// Campos de la lista blanca del payload que se auditan. Todo lo demás (por ejemplo,
// datos migratorios) se ignora; `billingCustomer` solo se resume en has_billing_customer.
const AUDITED_PAYLOAD_FIELDS = [
  'stayId',
  'reservationRef',
  'roomId',
  'categoryRoom',
  'checkInDate',
  'checkOutDate',
] as const;

export type CheckoutAuditPayload = Partial<
  Record<(typeof AUDITED_PAYLOAD_FIELDS)[number], string>
> & { has_billing_customer: boolean };

// Datos tributarios tal como llegan. 010 no juzga si bastan: eso lo decide 006.
export interface BillingCustomer {
  name: string | null;
  taxId: string | null;
}

// Sobre reconocible: JSON con un `eventId` UUID. Ya se puede registrar y deduplicar,
// aunque el resto del evento sea inválido.
export class RecognizedCheckoutEnvelope {
  constructor(
    readonly eventId: string,
    private readonly raw: Readonly<Record<string, unknown>>,
  ) {}

  // Lo que se guarda en auditoría antes de validar: solo valores bien formados.
  get eventType(): string | null {
    return typeof this.raw.eventType === 'string' ? this.raw.eventType : null;
  }

  get occurredAt(): Date | null {
    return parseInstant(this.raw.occurredAt);
  }

  get stayId(): string | null {
    const stayId = payloadOf(this.raw)?.stayId;
    return isUuid(stayId) ? stayId.toLowerCase() : null;
  }

  auditPayload(): CheckoutAuditPayload {
    return auditPayloadOf(payloadOf(this.raw) ?? {});
  }

  // Valida el evento completo (FR-002, FR-003, FR-005). Lanza InvalidCheckoutEventError
  // con el motivo del primer dato inválido.
  toCheckoutEvent(): CheckoutEvent {
    if (this.raw.eventType !== CHECK_OUT_EVENT_TYPE) {
      throw invalid(`eventType debe ser ${CHECK_OUT_EVENT_TYPE}.`);
    }
    if (this.raw.sourceModule !== MODULE_1_SOURCE) {
      throw invalid(`sourceModule debe ser ${MODULE_1_SOURCE}.`);
    }
    const occurredAt = parseInstant(this.raw.occurredAt);
    if (!occurredAt) {
      throw invalid(
        'occurredAt debe ser una fecha y hora ISO 8601 con zona horaria (Z o un offset como -05:00).',
      );
    }
    const payload = payloadOf(this.raw);
    if (!payload) {
      throw invalid('payload es obligatorio y debe ser un objeto.');
    }

    const stayId = requireUuid(payload.stayId, 'payload.stayId');
    const reservationRef = requireText(payload.reservationRef, 'payload.reservationRef');
    const roomId = requireUuid(payload.roomId, 'payload.roomId');
    const categoryRoom = requireText(payload.categoryRoom, 'payload.categoryRoom');
    const checkInDate = requireDate(payload.checkInDate, 'payload.checkInDate');
    const checkOutDate = requireDate(payload.checkOutDate, 'payload.checkOutDate');
    // Fechas YYYY-MM-DD: el orden de texto coincide con el cronológico. La salida el
    // mismo día de la entrada es válida (FR-003).
    if (checkOutDate < checkInDate) {
      throw invalid(
        `payload.checkOutDate (${checkOutDate}) no puede ser anterior a payload.checkInDate (${checkInDate}).`,
      );
    }

    return new CheckoutEvent(
      this.eventId,
      occurredAt,
      stayId,
      reservationRef,
      roomId,
      categoryRoom,
      checkInDate,
      checkOutDate,
      billingCustomerOf(payload.billingCustomer),
    );
  }
}

export type EnvelopeRecognition =
  | { recognized: true; envelope: RecognizedCheckoutEnvelope }
  | { recognized: false; reason: string };

// Decide si el mensaje tiene un sobre reconocible. `parsed` es el JSON ya interpretado.
export function recognizeCheckoutEnvelope(parsed: unknown): EnvelopeRecognition {
  if (!isRecord(parsed)) {
    return { recognized: false, reason: 'El sobre del evento no es un objeto JSON.' };
  }
  if (!isUuid(parsed.eventId)) {
    return {
      recognized: false,
      reason: 'El sobre del evento no trae un eventId con formato UUID.',
    };
  }
  return {
    recognized: true,
    envelope: new RecognizedCheckoutEnvelope(parsed.eventId.toLowerCase(), parsed),
  };
}

// Evento `Registrar Check-out` validado. Solo contiene la lista blanca del contrato.
export class CheckoutEvent {
  constructor(
    readonly eventId: string,
    readonly occurredAt: Date,
    readonly stayId: string,
    readonly reservationRef: string,
    readonly roomId: string,
    readonly categoryRoom: string,
    readonly checkInDate: string,
    readonly checkOutDate: string,
    // null si el evento no trae el objeto billingCustomer.
    readonly billingCustomer: BillingCustomer | null,
  ) {}

  auditPayload(): CheckoutAuditPayload {
    return {
      stayId: this.stayId,
      reservationRef: this.reservationRef,
      roomId: this.roomId,
      categoryRoom: this.categoryRoom,
      checkInDate: this.checkInDate,
      checkOutDate: this.checkOutDate,
      has_billing_customer: this.billingCustomer !== null,
    };
  }
}

function payloadOf(raw: Readonly<Record<string, unknown>>): Record<string, unknown> | null {
  return isRecord(raw.payload) ? raw.payload : null;
}

// Solo se copian textos de la lista blanca: un valor con otro tipo no se audita.
function auditPayloadOf(payload: Record<string, unknown>): CheckoutAuditPayload {
  const audit: CheckoutAuditPayload = { has_billing_customer: isRecord(payload.billingCustomer) };
  for (const field of AUDITED_PAYLOAD_FIELDS) {
    const value = payload[field];
    if (typeof value === 'string') {
      audit[field] = value;
    }
  }
  return audit;
}

// Los datos tributarios nunca invalidan el evento (FR-002, BR-003): si no son un objeto
// se tratan como ausentes, y un campo que no es texto, como faltante.
function billingCustomerOf(value: unknown): BillingCustomer | null {
  if (!isRecord(value)) {
    return null;
  }
  return {
    name: typeof value.name === 'string' ? value.name : null,
    taxId: typeof value.taxId === 'string' ? value.taxId : null,
  };
}

function requireUuid(value: unknown, field: string): string {
  if (!isUuid(value)) {
    throw invalid(`${field} es obligatorio y debe ser un UUID.`);
  }
  return value.toLowerCase();
}

function requireText(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw invalid(`${field} es obligatorio y debe ser un texto no vacío.`);
  }
  return value;
}

function requireDate(value: unknown, field: string): string {
  if (typeof value !== 'string' || !isCivilDate(value)) {
    throw invalid(`${field} es obligatoria y debe ser una fecha válida con formato YYYY-MM-DD.`);
  }
  return value;
}

function invalid(message: string): InvalidCheckoutEventError {
  return new InvalidCheckoutEventError(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_FORMAT.test(value);
}

// Fecha civil que existe en el calendario gregoriano (rechaza 2026-02-30).
function isCivilDate(value: string): boolean {
  const match = DATE_FORMAT.exec(value);
  if (!match) {
    return false;
  }
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  return year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    return leap ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

// `Date` acepta valores como 2026-02-30 o 24:00 y los corre en silencio; por eso se
// validan antes la fecha, la hora y el offset.
function parseInstant(value: unknown): Date | null {
  if (typeof value !== 'string') {
    return null;
  }
  const match = INSTANT_FORMAT.exec(value);
  if (!match || !isCivilDate(match[1])) {
    return null;
  }
  const [hours, minutes, seconds] = [Number(match[2]), Number(match[3]), Number(match[4] ?? 0)];
  const [offsetHours, offsetMinutes] = [Number(match[5] ?? 0), Number(match[6] ?? 0)];
  if (hours > 23 || minutes > 59 || seconds > 59 || offsetHours > 23 || offsetMinutes > 59) {
    return null;
  }
  const instant = new Date(value);
  return Number.isNaN(instant.getTime()) ? null : instant;
}
