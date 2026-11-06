// Feature 007 · Generar liquidación
import { randomUUID } from 'node:crypto';
import { QuoteNotFoundError } from '../../../domain/errors/settlement/quote-not-found.error';
import { SettlementAlreadyExistsError } from '../../../domain/errors/settlement/settlement-already-exists.error';
import { LodgingQuote } from '../../../domain/model/pricing/lodging-quote';
import { CheckoutData } from '../../../domain/model/settlement/checkout-data';
import { channelTermsOf, ReservationData } from '../../../domain/model/settlement/reservation-data';
import { Settlement } from '../../../domain/model/settlement/settlement';
import { SettlementCalculator } from '../../../domain/model/settlement/settlement-calculator';
import {
  GenerateSettlementCommand,
  GenerateSettlementUseCase,
} from '../../../domain/ports/in/settlement/generate-settlement.use-case';
import { LodgingQuoteQueryPort } from '../../../domain/ports/out/pricing/lodging-quote-query.port';
import { ReservationClientPort } from '../../../domain/ports/out/settlement/reservation.client.port';
import {
  SettlementRepositoryPort,
  STAY_ALREADY_SETTLED,
} from '../../../domain/ports/out/settlement/settlement.repository.port';

// Sin decoradores de NestJS: la capa de aplicación solo depende del dominio.
// El wiring con sus adaptadores está en infrastructure/config/settlement.module.ts.
//
// Orden del contrato UC-generate-settlement: comando → idempotencia → reserva (Módulo 2)
// → cotización → canal y comisión → cálculo → guardado. El primer paso que falla detiene
// todo y no se guarda nada (BR-007). No modifica la habitación ni emite la factura
// (FR-018, FR-019).
export class GenerateSettlementService implements GenerateSettlementUseCase {
  constructor(
    private readonly reservations: ReservationClientPort,
    private readonly quotes: LodgingQuoteQueryPort,
    private readonly settlements: SettlementRepositoryPort,
    private readonly newSettlementId: () => string = randomUUID,
  ) {}

  async generate(command: GenerateSettlementCommand): Promise<Settlement> {
    // Se revalida aunque 010 ya validó el evento, antes de tocar Módulo 2 o la base.
    const checkout = CheckoutData.of(command);

    // Idempotencia primero: un reenvío no vuelve a consultar Módulo 2 ni recalcula (FR-011).
    const existing = await this.settlements.findByStayId(checkout.stayId);
    if (existing) return this.sameCheckoutOrReject(existing, checkout);

    const reservation = await this.reservations.getReservation(
      checkout.reservationRef,
      checkout.eventId,
    );
    const quote = await this.quoteOf(reservation, checkout);
    const terms = channelTermsOf(reservation);
    const breakdown = SettlementCalculator.calculate({
      quote,
      channel: terms.channel,
      commission: terms.commission,
    });

    const saved = await this.settlements.insert(
      Settlement.prepare({
        settlementId: this.newSettlementId(),
        checkout,
        quoteId: quote.quoteId,
        terms,
        breakdown,
      }),
    );
    if (saved !== STAY_ALREADY_SETTLED) return saved;

    // Otra entrega del mismo evento ganó la inserción (UNIQUE(stay_id)): se lee la que quedó
    // y se aplica la misma regla de comparación (FR-011).
    const winner = await this.settlements.findByStayId(checkout.stayId);
    if (!winner) {
      throw new Error(
        `La base de datos informó una liquidación para la estancia ${checkout.stayId}, pero no se pudo leer.`,
      );
    }
    return this.sameCheckoutOrReject(winner, checkout);
  }

  private sameCheckoutOrReject(existing: Settlement, checkout: CheckoutData): Settlement {
    const differences = existing.differencesWith(checkout);
    if (differences.length > 0) {
      throw new SettlementAlreadyExistsError(checkout.stayId, differences);
    }
    return existing;
  }

  // La cotización de la habitación del check-out, elegida por roomId y no por tipo de
  // habitación (FR-020). Si hubiera varias (no debería), la de menor quoteId, para que el
  // resultado sea siempre el mismo (NFR-001).
  private async quoteOf(
    reservation: ReservationData,
    checkout: CheckoutData,
  ): Promise<LodgingQuote> {
    const candidates =
      reservation.quoteIds.length === 0
        ? []
        : await this.quotes.findByIds([...reservation.quoteIds]);
    const [quote] = candidates
      .filter((candidate) => candidate.roomId.toLowerCase() === checkout.roomId)
      .sort((a, b) => compareIds(a.quoteId, b.quoteId));
    if (!quote) {
      throw new QuoteNotFoundError(checkout.reservationRef, checkout.roomId);
    }
    return quote;
  }
}

function compareIds(a: string, b: string): number {
  const left = a.toLowerCase();
  const right = b.toLowerCase();
  return left < right ? -1 : left > right ? 1 : 0;
}
