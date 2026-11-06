// Feature 005 · Consultar tarifa dinámica
// Dobles de los puertos que usa 005: tarifa base (004), reglas de temporada (009),
// calendario (011), cotizaciones guardadas (005) y reservas de Módulo 2 (007, para la
// HU4). Sin red ni base de datos.
import { ReservationNotFoundError } from '../../../src/domain/errors/settlement/reservation-not-found.error';
import { BaseRate } from '../../../src/domain/model/pricing/base-rate';
import { ReservationData } from '../../../src/domain/model/settlement/reservation-data';
import { LodgingQuote } from '../../../src/domain/model/pricing/lodging-quote';
import { GetBaseRateUseCase } from '../../../src/domain/ports/in/pricing/get-base-rate.use-case';
import {
  EffectiveSeasonRule,
  EffectiveSeasonRules,
  GetEffectiveSeasonRulesUseCase,
} from '../../../src/domain/ports/in/pricing/get-effective-season-rules.use-case';
import {
  ResolveSeasonByDateQuery,
  ResolveSeasonByDateUseCase,
  SeasonClassification,
} from '../../../src/domain/ports/in/pricing/resolve-season-by-date.use-case';
import { LodgingQuoteQueryPort } from '../../../src/domain/ports/out/pricing/lodging-quote-query.port';
import { LodgingQuoteRepositoryPort } from '../../../src/domain/ports/out/pricing/lodging-quote.repository.port';
import { ReservationClientPort } from '../../../src/domain/ports/out/settlement/reservation.client.port';

// Mismo id fijo que siembra 009 para Regular.
export const REGULAR_ID = '00000000-0000-4000-8000-000000000001';
export const ALTA_ID = '5dca644e-7a6a-4d2e-a9a5-1943188c4710';
export const BAJA_ID = '8b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e';

export function seasonRule(
  seasonId: string,
  name: string,
  adjustmentPercent: string,
  isDefault = false,
): EffectiveSeasonRule {
  return {
    seasonId,
    name,
    color: '#1E88E5',
    adjustmentPercent,
    isDefault,
    validFrom: '2026-01-01T00:00:00.000Z',
    archivedAt: null,
  };
}

// 009: snapshot del catálogo. Por defecto Regular 0.00, Alta +20.00 y Baja -10.00.
export class FakeSeasonRules implements GetEffectiveSeasonRulesUseCase {
  seasons: EffectiveSeasonRule[] = [
    seasonRule(REGULAR_ID, 'Regular', '0.00', true),
    seasonRule(ALTA_ID, 'Alta', '20.00'),
    seasonRule(BAJA_ID, 'Baja', '-10.00'),
  ];
  calls: Date[] = [];
  failure?: Error;

  async getAll(asOf: Date): Promise<EffectiveSeasonRules> {
    this.calls.push(asOf);
    if (this.failure) throw this.failure;
    return {
      asOf: asOf.toISOString(),
      defaultSeasonId: REGULAR_ID,
      seasons: this.seasons.map((season) => ({ ...season })),
    };
  }

  setAdjustment(seasonId: string, adjustmentPercent: string): void {
    this.seasons = this.seasons.map((season) =>
      season.seasonId === seasonId ? { ...season, adjustmentPercent } : season,
    );
  }
}

// 011: temporada de cada fecha. Sin asignación devuelve Regular con source DEFAULT.
export class FakeSeasonCalendar implements ResolveSeasonByDateUseCase {
  assignments = new Map<string, string>();
  calls: ResolveSeasonByDateQuery[] = [];
  failure?: Error;

  assign(dates: string[], seasonId: string): void {
    for (const date of dates) this.assignments.set(date, seasonId);
  }

  async resolve(query: ResolveSeasonByDateQuery): Promise<SeasonClassification> {
    this.calls.push(query);
    if (this.failure) throw this.failure;
    const assigned = this.assignments.get(query.date);
    return {
      date: query.date,
      seasonId: assigned ?? REGULAR_ID,
      source: assigned ? 'BASE' : 'DEFAULT',
      entryId: null,
      calendarYear: Number(query.date.slice(0, 4)),
      revision: 1,
      calendarEffectiveAt: '2026-01-01T00:00:00.000Z',
      entryOwnerYear: null,
      entryOwnerRevision: null,
      entryOwnerEffectiveAt: null,
    };
  }
}

// 004: tarifa base de Módulo 1. 300000.00 para cualquier noche salvo que se indique otra.
export class FakeBaseRates implements GetBaseRateUseCase {
  defaultRate = '300000.00';
  rates = new Map<string, string>();
  failures = new Map<string, Error>();
  calls: { roomId: string; date: string }[] = [];
  inFlight = 0;
  maxInFlight = 0;

  async execute(roomId: string, date: string): Promise<BaseRate> {
    this.calls.push({ roomId, date });
    this.inFlight += 1;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    try {
      // Cede el turno para que las noches en paralelo se solapen de verdad.
      await new Promise((resolve) => setImmediate(resolve));
      const failure = this.failures.get(date);
      if (failure) throw failure;
      return BaseRate.create(this.rates.get(date) ?? this.defaultRate);
    } finally {
      this.inFlight -= 1;
    }
  }
}

// 005: cotizaciones guardadas en memoria, con las mismas reglas que el puerto real.
export class InMemoryLodgingQuoteRepository
  implements LodgingQuoteRepositoryPort, LodgingQuoteQueryPort
{
  quotes = new Map<string, LodgingQuote>();
  failure?: Error;

  async insert(quote: LodgingQuote): Promise<void> {
    if (this.failure) throw this.failure;
    if (this.quotes.has(quote.quoteId)) throw new Error(`quoteId repetido: ${quote.quoteId}`);
    this.quotes.set(quote.quoteId, quote);
  }

  async findByIds(quoteIds: string[]): Promise<LodgingQuote[]> {
    return [...new Set(quoteIds)].flatMap((id) => {
      const quote = this.quotes.get(id.toLowerCase());
      return quote ? [quote] : [];
    });
  }
}

// 005 HU4: Módulo 2 en memoria. Una reserva que no está → ReservationNotFoundError (el 404
// de Módulo 2); `failure` simula que Módulo 2 no responde.
export class FakeReservationClient implements ReservationClientPort {
  reservations = new Map<string, ReservationData>();
  failure?: Error;
  calls: string[] = [];

  async getReservation(reservationRef: string): Promise<ReservationData> {
    this.calls.push(reservationRef);
    if (this.failure) throw this.failure;
    const reservation = this.reservations.get(reservationRef);
    if (!reservation) throw new ReservationNotFoundError(reservationRef);
    return reservation;
  }
}
