// Feature 005 · Consultar tarifa dinámica
import { DynamicRateAccessDeniedError } from '../../../domain/errors/pricing/dynamic-rate-access-denied.error';
import { InvalidPricingRequestError } from '../../../domain/errors/pricing/invalid-pricing-request.error';
import { ReservationNotFoundError } from '../../../domain/errors/settlement/reservation-not-found.error';
import { StayRange } from '../../../domain/model/pricing/stay-range';
import { OTA_CHANNEL, ReservationData } from '../../../domain/model/settlement/reservation-data';
import { Money } from '../../../domain/model/shared/money.vo';
import {
  DynamicRateCaller,
  DynamicRateQuery,
  DynamicRateResult,
  GetDynamicRateUseCase,
  INTERNAL_CALLER,
} from '../../../domain/ports/in/pricing/get-dynamic-rate.use-case';
import { LodgingQuoteQueryPort } from '../../../domain/ports/out/pricing/lodging-quote-query.port';
import { ReservationClientPort } from '../../../domain/ports/out/settlement/reservation.client.port';
import { DynamicRateCalculator } from './dynamic-rate-calculator';
import { parseDate, parseRoomId, parseStay } from './pricing-request';

// Tarifa base (004) + reglas de temporada (009) + calendario (011), noche por noche.
// Solo lectura: no guarda nada (FR-007). Módulo 2 consulta cualquier habitación; la OTA,
// solo las de sus reservas (HU4), verificadas con el cliente de Módulo 2 de 007.
export class GetDynamicRateService implements GetDynamicRateUseCase {
  constructor(
    private readonly calculator: DynamicRateCalculator,
    private readonly reservations: ReservationClientPort,
    private readonly quotes: LodgingQuoteQueryPort,
  ) {}

  async execute(
    query: DynamicRateQuery,
    caller: DynamicRateCaller = INTERNAL_CALLER,
  ): Promise<DynamicRateResult> {
    // Parámetros y rango primero, sin llamar a ningún puerto (contrato GET, regla 1).
    const roomId = parseRoomId(query.roomId);
    const stay = this.stayOf(query);

    // Acceso de la OTA antes de calcular: una OTA sin acceso nunca provoca llamadas a
    // Módulo 1, 009 ni 011 (contrato GET, regla 2). Sin token, reservationRef se ignora.
    if (caller.kind === 'OTA') {
      await this.assertOtaCanQuery(caller.otaId, reservationRefOf(query), roomId);
    }

    const nights = await this.calculator.calculate(roomId, stay);
    const total = nights.reduce((sum, night) => sum.add(night.dynamicRate), Money.zero());
    return { roomId, currency: 'COP', nights, total };
  }

  // `date` para una noche, o `checkInDate` + `checkOutDate`; nunca los dos ni a medias.
  private stayOf(query: DynamicRateQuery): StayRange {
    const hasDate = query.date !== undefined;
    const hasRange = query.checkInDate !== undefined || query.checkOutDate !== undefined;
    if (hasDate === hasRange) {
      throw new InvalidPricingRequestError(
        'Envía date (una noche) o checkInDate y checkOutDate (un rango), pero no los dos.',
      );
    }
    return hasDate
      ? StayRange.singleNight(parseDate(query.date, 'date'))
      : parseStay(query.checkInDate, query.checkOutDate);
  }

  // La reserva debe ser del canal OTA, de esta OTA, y tener una cotización de la habitación
  // consultada (FR-010, BR-002). Cualquier otro caso, también una reserva inexistente,
  // responde lo mismo: la OTA nunca sabe si una reserva ajena existe. Si Módulo 2 no
  // responde, Module2UnavailableError sigue su curso (424, reintentable).
  private async assertOtaCanQuery(
    otaId: string,
    reservationRef: string,
    roomId: string,
  ): Promise<void> {
    const reservation = await this.reservationOf(reservationRef);
    if (reservation.channel !== OTA_CHANNEL || reservation.otaId !== otaId) {
      throw new DynamicRateAccessDeniedError();
    }
    const quotes =
      reservation.quoteIds.length === 0
        ? []
        : await this.quotes.findByIds([...reservation.quoteIds]);
    // Las cotizaciones guardan el roomId en minúsculas (uuid de PostgreSQL).
    const room = roomId.toLowerCase();
    if (!quotes.some((quote) => quote.roomId.toLowerCase() === room)) {
      throw new DynamicRateAccessDeniedError();
    }
  }

  // El 404 de Módulo 2 se responde como cualquier otra reserva ajena: la OTA nunca recibe
  // RESERVATION_NOT_FOUND (plan base, acceso de la OTA).
  private async reservationOf(reservationRef: string): Promise<ReservationData> {
    try {
      return await this.reservations.getReservation(reservationRef);
    } catch (error) {
      if (error instanceof ReservationNotFoundError) throw new DynamicRateAccessDeniedError();
      throw error;
    }
  }
}

// Obligatorio para la OTA (contrato GET, parámetros).
function reservationRefOf(query: DynamicRateQuery): string {
  const reservationRef = query.reservationRef;
  if (typeof reservationRef !== 'string' || reservationRef.trim() === '') {
    throw new InvalidPricingRequestError(
      'La OTA debe enviar reservationRef: la reserva a la que pertenece la habitación.',
    );
  }
  return reservationRef;
}
