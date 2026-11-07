// Feature 010 · Registrar Check-out
import { DomainError } from '../../../domain/errors/domain.error';
import { InvalidCheckoutEventError } from '../../../domain/errors/checkout-ingestion/invalid-checkout-event.error';
import {
  CheckoutEvent,
  RecognizedCheckoutEnvelope,
  recognizeCheckoutEnvelope,
} from '../../../domain/model/checkout-ingestion/checkout-event';
import { pendingCheckoutEventLog } from '../../../domain/model/checkout-ingestion/checkout-event-log';
import {
  RegisterCheckoutCommand,
  RegisterCheckoutResult,
  RegisterCheckoutUseCase,
} from '../../../domain/ports/in/checkout-ingestion/register-checkout.use-case';
import { CheckoutEventLogRepositoryPort } from '../../../domain/ports/out/checkout-ingestion/checkout-event-log.repository.port';
import {
  CheckoutEventProcessorPort,
  CheckoutProcessingResult,
} from '../../../domain/ports/out/checkout-ingestion/checkout-event-processor.port';
import { CheckoutMessagePublisherPort } from '../../../domain/ports/out/checkout-ingestion/checkout-message-publisher.port';

// Tras el primer intento, hasta 5 reintentos separados por 30 s (NFR-005).
export const MAX_CHECKOUT_RETRIES = 5;
export const RETRY_COUNT_HEADER = 'x-retry-count';

// Fallas transitorias: van a la cola de reintento mientras x-retry-count < 5. Cualquier
// otro código (incluido un error no tipado) va directo a la DLQ (contrato, sección 4).
export const TRANSIENT_CHECKOUT_ERROR_CODES: ReadonlySet<string> = new Set([
  'MODULE2_UNAVAILABLE',
  'VAT_RATE_UNAVAILABLE',
  'DATABASE_UNAVAILABLE',
]);
const DATABASE_UNAVAILABLE = 'DATABASE_UNAVAILABLE';
const UNEXPECTED_ERROR = 'UNEXPECTED_ERROR';

export type CheckoutOutcome =
  | 'PROCESSED'
  | 'DUPLICATE'
  | 'REJECTED'
  | 'DEAD_LETTER'
  | 'RETRY'
  | 'NACK_REQUEUE';

// Entrada del log estructurado (plan 010, "Observabilidad y privacidad"): nunca lleva
// datos tributarios ni migratorios.
export interface CheckoutLogEntry {
  eventId: string | null;
  stayId: string | null;
  outcome: CheckoutOutcome;
  errorCode: string | null;
  durationMs: number;
}

interface Trace {
  eventId: string | null;
  stayId: string | null;
  errorCode: string | null;
}

// Sin decoradores de NestJS: la capa de aplicación solo depende del dominio.
// El wiring con sus adaptadores está en infrastructure/config/checkout-ingestion.module.ts.
export class RegisterCheckoutService implements RegisterCheckoutUseCase {
  constructor(
    private readonly eventLogs: CheckoutEventLogRepositoryPort,
    private readonly publisher: CheckoutMessagePublisherPort,
    private readonly processor: CheckoutEventProcessorPort,
    private readonly log: (entry: CheckoutLogEntry) => void = () => undefined,
    private readonly now: () => number = Date.now,
  ) {}

  async register(command: RegisterCheckoutCommand): Promise<RegisterCheckoutResult> {
    const startedAt = this.now();
    const trace: Trace = { eventId: null, stayId: null, errorCode: null };
    let outcome: CheckoutOutcome;
    try {
      outcome = await this.handle(command, trace);
    } catch {
      // Defensa: el contrato del puerto es no lanzar nunca.
      outcome = 'NACK_REQUEUE';
    }
    this.log({ ...trace, outcome, durationMs: this.now() - startedAt });
    return outcome === 'NACK_REQUEUE' ? 'NACK_REQUEUE' : 'ACK';
  }

  private async handle(command: RegisterCheckoutCommand, trace: Trace): Promise<CheckoutOutcome> {
    const parsed = parseJson(command.body);
    if (!parsed.ok) {
      trace.errorCode = 'INVALID_CHECKOUT_EVENT';
      return this.rejectUnrecognized(command, 'El cuerpo del mensaje no es JSON válido en UTF-8.');
    }
    const recognition = recognizeCheckoutEnvelope(parsed.value);
    if (!recognition.recognized) {
      trace.errorCode = 'INVALID_CHECKOUT_EVENT';
      return this.rejectUnrecognized(command, recognition.reason);
    }

    const envelope = recognition.envelope;
    trace.eventId = envelope.eventId;
    trace.stayId = envelope.stayId;

    let isPending: boolean;
    try {
      isPending = (await this.eventLogs.registerIfAbsent(pendingCheckoutEventLog(envelope)))
        .isPending;
    } catch (error) {
      // Sin auditoría no hay procesamiento: sigue la ruta de reintento aunque el
      // registro todavía no exista (contrato, DATABASE_UNAVAILABLE).
      trace.errorCode = DATABASE_UNAVAILABLE;
      return this.retryOrDeadLetter(
        command,
        envelope,
        false,
        DATABASE_UNAVAILABLE,
        reasonOf(error),
      );
    }
    if (!isPending) {
      return 'DUPLICATE'; // Ya PROCESSED, REJECTED o DEAD_LETTER: ack sin reprocesar.
    }

    let event: CheckoutEvent;
    try {
      event = envelope.toCheckoutEvent();
    } catch (error) {
      if (!(error instanceof InvalidCheckoutEventError)) {
        throw error;
      }
      trace.errorCode = error.errorCode;
      return this.deadLetter(command, 'REJECTED', () =>
        this.eventLogs.markRejected(envelope.eventId, error.errorCode, error.message),
      );
    }

    let result: CheckoutProcessingResult;
    try {
      result = await this.processor.process(event);
    } catch (error) {
      const errorCode = error instanceof DomainError ? error.errorCode : UNEXPECTED_ERROR;
      trace.errorCode = errorCode;
      if (TRANSIENT_CHECKOUT_ERROR_CODES.has(errorCode)) {
        return this.retryOrDeadLetter(command, envelope, true, errorCode, reasonOf(error));
      }
      return this.deadLetter(command, 'DEAD_LETTER', () =>
        this.eventLogs.markDeadLetter(envelope.eventId, errorCode, reasonOf(error)),
      );
    }

    try {
      await this.eventLogs.markProcessed(envelope.eventId, result.resultNote);
    } catch (error) {
      // Reintentar es seguro: 007 y 006 son idempotentes por stayId.
      trace.errorCode = DATABASE_UNAVAILABLE;
      return this.retryOrDeadLetter(command, envelope, true, DATABASE_UNAVAILABLE, reasonOf(error));
    }
    return 'PROCESSED';
  }

  // JSON inválido o sin eventId UUID: DLQ y, ya confirmada, el registro sin event_id.
  private rejectUnrecognized(
    command: RegisterCheckoutCommand,
    reason: string,
  ): Promise<CheckoutOutcome> {
    return this.deadLetter(command, 'REJECTED', () =>
      this.eventLogs.registerUnrecognizedEnvelopeRejection(reason),
    );
  }

  // Falla transitoria: a la cola de reintento con el contador incrementado o, agotados
  // los reintentos, a la DLQ con el código del fallo actual.
  private async retryOrDeadLetter(
    command: RegisterCheckoutCommand,
    envelope: RecognizedCheckoutEnvelope,
    hasRecord: boolean,
    errorCode: string,
    reason: string,
  ): Promise<CheckoutOutcome> {
    const retryCount = retryCountOf(command.headers);
    if (retryCount < MAX_CHECKOUT_RETRIES) {
      try {
        await this.publisher.publishToRetry(command.body, command.headers, retryCount + 1);
      } catch {
        return 'NACK_REQUEUE';
      }
      return 'RETRY';
    }
    return this.deadLetter(command, 'DEAD_LETTER', async () => {
      if (!hasRecord) {
        await this.eventLogs.registerIfAbsent(pendingCheckoutEventLog(envelope));
      }
      await this.eventLogs.markDeadLetter(envelope.eventId, errorCode, reason);
    });
  }

  // El estado final se escribe solo después del publisher confirm. Si la publicación
  // falla, o si falla la escritura posterior, se hace nack con reencolado y la
  // reentrega repite la publicación (la DLQ puede recibir una copia duplicada).
  private async deadLetter(
    command: RegisterCheckoutCommand,
    outcome: 'REJECTED' | 'DEAD_LETTER',
    recordFinalState: () => Promise<void>,
  ): Promise<CheckoutOutcome> {
    try {
      await this.publisher.publishToDeadLetter(command.body, command.headers);
      await recordFinalState();
    } catch {
      return 'NACK_REQUEUE';
    }
    return outcome;
  }
}

// x-retry-count es un entero no negativo; ausente, no entero o negativo cuenta como 0.
export function retryCountOf(headers: Readonly<Record<string, unknown>>): number {
  const value = headers[RETRY_COUNT_HEADER];
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0;
}

// UTF-8 estricto y JSON. Cualquier fallo deja el sobre como no reconocible.
function parseJson(body: Uint8Array): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body)) };
  } catch {
    return { ok: false };
  }
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
