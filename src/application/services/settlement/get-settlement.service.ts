// Feature 002 · Consultar liquidación
import { QuoteNotFoundError } from '../../../domain/errors/settlement/quote-not-found.error';
import { SettlementNotFoundError } from '../../../domain/errors/settlement/settlement-not-found.error';
import { LodgingQuote } from '../../../domain/model/pricing/lodging-quote';
import { channelTermsOf, ReservationData } from '../../../domain/model/settlement/reservation-data';
import { Settlement } from '../../../domain/model/settlement/settlement';
import { SettlementCalculator } from '../../../domain/model/settlement/settlement-calculator';
import {
  parseSettlementQuery,
  SettlementCaller,
  SettlementQuery,
} from '../../../domain/model/settlement/settlement-query';
import {
  finalSettlementResult,
  GetSettlementResult,
  informativeSettlementResult,
  SettlementQueryResult,
} from '../../../domain/model/settlement/settlement-query-result';
import { GetSettlementUseCase } from '../../../domain/ports/in/settlement/get-settlement.use-case';
import { LodgingQuoteQueryPort } from '../../../domain/ports/out/pricing/lodging-quote-query.port';
import { ReservationClientPort } from '../../../domain/ports/out/settlement/reservation.client.port';
import { SettlementInvoiceQueryPort } from '../../../domain/ports/out/settlement/settlement-invoice-query.port';
import { SettlementQueryPort } from '../../../domain/ports/out/settlement/settlement-query.port';
import { SettlementRepositoryPort } from '../../../domain/ports/out/settlement/settlement.repository.port';

const OTA_CHANNEL = 'OTA';

// Consulta de liquidaciones (contrato GET-settlements.md). Solo lee: no crea, modifica ni
// recalcula liquidaciones ni facturas (FR-004, BR-001). La informativa de Módulo 1 se
// calcula en memoria y nunca se guarda (FR-011).
//
// Sin decoradores de NestJS: el wiring está en infrastructure/config/settlement.module.ts.
export class GetSettlementService implements GetSettlementUseCase {
  constructor(
    private readonly settlementQuery: SettlementQueryPort,
    private readonly invoices: SettlementInvoiceQueryPort,
    // De 007: la Final de una habitación (findByReservationAndRoom) y la reserva en Módulo 2.
    private readonly settlements: SettlementRepositoryPort,
    private readonly reservations: ReservationClientPort,
    // De 005: las cotizaciones guardadas, sin recalcular la tarifa dinámica.
    private readonly quotes: LodgingQuoteQueryPort,
    // Momento del cálculo de la informativa; inyectable para pruebas deterministas.
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute(query: SettlementQuery, caller: SettlementCaller): Promise<GetSettlementResult> {
    const valid = parseSettlementQuery(query, caller);
    if (valid.kind === 'OTA') {
      return this.forOta(valid.reservationRef, valid.otaId);
    }
    return this.forModule1(valid.reservationRef, valid.roomId, valid.correlationId);
  }

  // HU2: la Final de la habitación si ya tuvo check-out; si no, la informativa calculada
  // ahora (FR-009). Una sola liquidación, nunca una colección.
  private async forModule1(
    reservationRef: string,
    requestedRoomId: string,
    correlationId?: string,
  ): Promise<GetSettlementResult> {
    // 007 guarda roomId en minúsculas; se compara igual que en Generar liquidación.
    const roomId = requestedRoomId.toLowerCase();

    // Primero la Final (T015): si existe, se devuelve tal como se guardó, sin consultar a
    // Módulo 2 ni recalcular (FR-004, BR-003).
    const stored = await this.settlements.findByReservationAndRoom(reservationRef, roomId);
    if (stored) {
      return { kind: 'SINGLE', settlement: await this.withInvoice(stored) };
    }

    // Informativa (T016), con los mismos pasos y el mismo orden que Generar liquidación:
    // reserva → cotización de la habitación → canal y comisión → cálculo (FR-008, SC-008).
    // El primer paso que falla detiene todo, sin valores parciales (FR-012).
    const reservation = await this.reservations.getReservation(reservationRef, correlationId);
    const quote = await this.quoteOf(reservation, reservationRef, roomId);
    const terms = channelTermsOf(reservation);
    const breakdown = SettlementCalculator.calculate({
      quote,
      channel: terms.channel,
      commission: terms.commission,
    });
    return {
      kind: 'SINGLE',
      settlement: informativeSettlementResult({
        reservationRef,
        roomId,
        terms,
        breakdown,
        calculatedAt: this.now(),
      }),
    };
  }

  // La cotización de la habitación consultada, elegida por roomId; categoryRoom no
  // interviene (FR-001). Si hubiera varias, la de menor quoteId, como en 007, para que la
  // informativa coincida con la Final.
  private async quoteOf(
    reservation: ReservationData,
    reservationRef: string,
    roomId: string,
  ): Promise<LodgingQuote> {
    const candidates =
      reservation.quoteIds.length === 0
        ? []
        : await this.quotes.findByIds([...reservation.quoteIds]);
    const [quote] = candidates
      .filter((candidate) => candidate.roomId.toLowerCase() === roomId)
      .sort((a, b) => compareIds(a.quoteId, b.quoteId));
    if (!quote) {
      throw new QuoteNotFoundError(reservationRef, roomId);
    }
    return quote;
  }

  // HU1: las Final de la reserva de la OTA, ordenadas por roomId, con su factura si ya se
  // emitió (FR-002, FR-003). Sin ninguna visible → SETTLEMENT_NOT_FOUND con el mismo
  // mensaje si no hay check-out, si la reserva es directa o si es de otra OTA (FR-005,
  // FR-006). Nunca una informativa ni valores en cero (BR-004).
  private async forOta(reservationRef: string, otaId: string): Promise<GetSettlementResult> {
    const found = await this.settlementQuery.findByReservationRefAndOtaId(reservationRef, otaId);
    // El adaptador ya filtra por OTA; se vuelve a comprobar para que ninguna liquidación
    // ajena llegue a la respuesta aunque el adaptador cambie (NFR-003, SC-002).
    const own = found.filter(
      (settlement) =>
        settlement.reservationRef === reservationRef &&
        settlement.channel === OTA_CHANNEL &&
        settlement.otaId === otaId,
    );
    if (own.length === 0) {
      throw new SettlementNotFoundError();
    }

    const ordered = [...own].sort(byRoomThenGeneratedAt);
    const settlements = await Promise.all(
      ordered.map((settlement) => this.withInvoice(settlement)),
    );
    return { kind: 'COLLECTION', reservationRef, settlements };
  }

  private async withInvoice(settlement: Settlement): Promise<SettlementQueryResult> {
    const invoice = await this.invoices.findBySettlementId(settlement.settlementId);
    return finalSettlementResult(settlement, invoice);
  }
}

// Orden estable por habitación (sin distinguir mayúsculas) y, si una habitación tuviera
// más de una estancia en la reserva, por fecha de generación (FR-008: mismo resultado en
// consultas repetidas).
function byRoomThenGeneratedAt(a: Settlement, b: Settlement): number {
  const room = a.roomId.toLowerCase().localeCompare(b.roomId.toLowerCase());
  if (room !== 0) return room;
  const generated = a.generatedAt.getTime() - b.generatedAt.getTime();
  if (generated !== 0) return generated;
  return a.settlementId.localeCompare(b.settlementId);
}

function compareIds(a: string, b: string): number {
  const left = a.toLowerCase();
  const right = b.toLowerCase();
  return left < right ? -1 : left > right ? 1 : 0;
}
