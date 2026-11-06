// Feature 007 · Generar liquidación
// Dobles de prueba de los puertos de GenerateSettlementService y datos de ejemplo del
// contrato UC-generate-settlement (cotización de 750.000 con 700.000 de tarifa base).
import { LodgingQuote } from '../../../src/domain/model/pricing/lodging-quote';
import { ReservationData } from '../../../src/domain/model/settlement/reservation-data';
import { NewSettlement, Settlement } from '../../../src/domain/model/settlement/settlement';
import { GenerateSettlementCommand } from '../../../src/domain/ports/in/settlement/generate-settlement.use-case';
import { LodgingQuoteQueryPort } from '../../../src/domain/ports/out/pricing/lodging-quote-query.port';
import { ReservationClientPort } from '../../../src/domain/ports/out/settlement/reservation.client.port';
import {
  SettlementRepositoryPort,
  STAY_ALREADY_SETTLED,
} from '../../../src/domain/ports/out/settlement/settlement.repository.port';

export const EVENT_ID = '9b1f6d3e-2c4a-4f7b-8e5d-3a1c0b9d8e72';
export const STAY_ID = 'c3a9e1b2-5f4d-4e6a-8b7c-1d2e3f4a5b6c';
export const RESERVATION_REF = 'RES-000123';
export const ROOM_A = '5f0e8a47-1b2c-4d3e-9f6a-7b8c9d0e1f23';
export const ROOM_B = '6a1f9b58-2c3d-4e4f-8a7b-8c9d0e1f2a34';
export const QUOTE_A = 'a1f2c3d4-e5b6-4789-8a9b-0c1d2e3f4a5b';
export const QUOTE_B = 'b7c8d9e0-f1a2-4b3c-8d4e-5f6a7b8c9d0e';
export const GENERATED_AT = new Date('2026-12-23T16:04:58.000Z');

export function checkoutCommand(
  overrides: Partial<GenerateSettlementCommand> = {},
): GenerateSettlementCommand {
  return {
    eventId: EVENT_ID,
    stayId: STAY_ID,
    reservationRef: RESERVATION_REF,
    roomId: ROOM_A,
    categoryRoom: 'DOBLE',
    checkInDate: '2026-12-20',
    checkOutDate: '2026-12-23',
    ...overrides,
  };
}

// [fecha, tarifa base, tarifa dinámica] de cada noche; el total es la suma de las tarifas.
type QuoteNight = [date: string, baseRate: string, rate: string];

// Por defecto: 3 noches, 700.000 de tarifa base y 750.000 de hospedaje.
const DEFAULT_NIGHTS: QuoteNight[] = [
  ['2026-12-20', '200000.00', '200000.00'],
  ['2026-12-21', '250000.00', '250000.00'],
  ['2026-12-22', '250000.00', '300000.00'],
];

export function storedQuote(
  quoteId: string,
  roomId: string,
  nights: QuoteNight[] = DEFAULT_NIGHTS,
  lodgingAmount = '750000.00',
): LodgingQuote {
  return LodgingQuote.restore({
    quoteId,
    roomId,
    checkInDate: nights[0][0],
    checkOutDate: '2026-12-23',
    currency: 'COP',
    lodgingAmount,
    nights: nights.map(([date, baseRate, rate]) => ({
      date,
      baseRate,
      seasonName: baseRate === rate ? 'Regular' : 'Alta',
      adjustmentPercent: baseRate === rate ? '0.00' : '20.00',
      rate,
    })),
  });
}

export function directReservation(overrides: Partial<ReservationData> = {}): ReservationData {
  return { reservationRef: RESERVATION_REF, quoteIds: [QUOTE_A], channel: null, ...overrides };
}

export function otaReservation(overrides: Partial<ReservationData> = {}): ReservationData {
  return {
    reservationRef: RESERVATION_REF,
    quoteIds: [QUOTE_A],
    channel: 'OTA',
    otaId: 'booking',
    otaConfirmationCode: 'BKG-88421',
    otaCommissionPercentage: 15,
    ...overrides,
  };
}

export class FakeReservationClient implements ReservationClientPort {
  readonly calls: Array<{ reservationRef: string; correlationId?: string }> = [];

  constructor(private result: ReservationData | Error = directReservation()) {}

  respondWith(result: ReservationData | Error): void {
    this.result = result;
  }

  async getReservation(reservationRef: string, correlationId?: string): Promise<ReservationData> {
    this.calls.push({ reservationRef, correlationId });
    if (this.result instanceof Error) throw this.result;
    return this.result;
  }
}

export class InMemoryLodgingQuotes implements LodgingQuoteQueryPort {
  readonly requests: string[][] = [];

  constructor(private readonly quotes: LodgingQuote[] = [storedQuote(QUOTE_A, ROOM_A)]) {}

  async findByIds(quoteIds: string[]): Promise<LodgingQuote[]> {
    this.requests.push([...quoteIds]);
    return this.quotes.filter((quote) => quoteIds.includes(quote.quoteId));
  }
}

export class InMemorySettlementRepository implements SettlementRepositoryPort {
  readonly byStayId = new Map<string, Settlement>();
  inserts = 0;
  // Simula otra entrega del mismo check-out que guarda primero, justo antes de este insert.
  private concurrentWinner?: NewSettlement;

  seed(settlement: NewSettlement): Settlement {
    const saved = Settlement.restore({ ...settlement, generatedAt: GENERATED_AT });
    this.byStayId.set(saved.stayId, saved);
    return saved;
  }

  saveConcurrentlyBeforeNextInsert(settlement: NewSettlement): void {
    this.concurrentWinner = settlement;
  }

  async findByStayId(stayId: string): Promise<Settlement | null> {
    return this.byStayId.get(stayId) ?? null;
  }

  async insert(settlement: NewSettlement): Promise<Settlement | typeof STAY_ALREADY_SETTLED> {
    this.inserts += 1;
    if (this.concurrentWinner) {
      this.seed(this.concurrentWinner);
      this.concurrentWinner = undefined;
    }
    if (this.byStayId.has(settlement.stayId)) return STAY_ALREADY_SETTLED;
    return this.seed(settlement);
  }

  async findByReservationAndRoom(
    reservationRef: string,
    roomId: string,
  ): Promise<Settlement | null> {
    return (
      [...this.byStayId.values()].find(
        (settlement) =>
          settlement.reservationRef === reservationRef && settlement.roomId === roomId,
      ) ?? null
    );
  }
}
