// Feature 002 · Consultar liquidación
// T012 (HU2): Módulo 1 consulta la liquidación de una habitación: la Final si ya tuvo
// check-out; si no, la informativa calculada en memoria, sin guardarla.
import { GenerateSettlementService } from '../../../../src/application/services/settlement/generate-settlement.service';
import { GetSettlementService } from '../../../../src/application/services/settlement/get-settlement.service';
import { InvalidCommissionError } from '../../../../src/domain/errors/settlement/invalid-commission.error';
import { InvalidSettlementQueryError } from '../../../../src/domain/errors/settlement/invalid-settlement-query.error';
import { MissingCommissionError } from '../../../../src/domain/errors/settlement/missing-commission.error';
import { Module2UnavailableError } from '../../../../src/domain/errors/settlement/module2-unavailable.error';
import { QuoteNotFoundError } from '../../../../src/domain/errors/settlement/quote-not-found.error';
import { ReservationNotFoundError } from '../../../../src/domain/errors/settlement/reservation-not-found.error';
import { SettlementNotFoundError } from '../../../../src/domain/errors/settlement/settlement-not-found.error';
import {
  INTERNAL_SETTLEMENT_CALLER,
  SettlementQuery,
} from '../../../../src/domain/model/settlement/settlement-query';
import {
  GetSettlementResult,
  SettlementQueryResult,
} from '../../../../src/domain/model/settlement/settlement-query-result';
import {
  checkoutCommand,
  directReservation,
  FakeReservationClient,
  InMemoryLodgingQuotes,
  InMemorySettlementRepository,
  otaReservation,
  QUOTE_A,
  QUOTE_B,
  RESERVATION_REF,
  ROOM_A,
  ROOM_B,
  storedQuote,
} from '../../../support/settlement/fake-settlement-ports';
import {
  directFinalSettlement,
  finalSettlement,
  InMemorySettlementInvoices,
  InMemorySettlementQuery,
  OTA_ID,
} from '../../../support/settlement/fake-settlement-query-ports';

const CALCULATED_AT = new Date('2026-12-21T15:30:00.000Z');
const CORRELATION_ID = 'corr-002-modulo1';

// ROOM_B: 2 noches, 500.000 de tarifa base y 600.000 de hospedaje (ajuste de +100.000).
const QUOTE_B_NIGHTS: Array<[string, string, string]> = [
  ['2026-12-20', '250000.00', '300000.00'],
  ['2026-12-21', '250000.00', '300000.00'],
];

function singleOf(result: GetSettlementResult): SettlementQueryResult {
  if (result.kind !== 'SINGLE') throw new Error('Se esperaba una sola liquidación para Módulo 1');
  return result.settlement;
}

describe('GetSettlementService — HU2: Módulo 1 consulta la liquidación de una habitación', () => {
  let finals: InMemorySettlementRepository;
  let invoices: InMemorySettlementInvoices;
  let otaQuery: InMemorySettlementQuery;
  let reservations: FakeReservationClient;
  let quotes: InMemoryLodgingQuotes;
  let service: GetSettlementService;

  function build(withQuotes = [storedQuote(QUOTE_A, ROOM_A)]): void {
    quotes = new InMemoryLodgingQuotes(withQuotes);
    service = new GetSettlementService(
      otaQuery,
      invoices,
      finals,
      reservations,
      quotes,
      () => CALCULATED_AT,
    );
  }

  const asModule1 = (query: SettlementQuery) => service.execute(query, INTERNAL_SETTLEMENT_CALLER);

  beforeEach(() => {
    finals = new InMemorySettlementRepository();
    invoices = new InMemorySettlementInvoices();
    otaQuery = new InMemorySettlementQuery();
    reservations = new FakeReservationClient(otaReservation());
    build();
  });

  describe('la habitación ya tuvo check-out: Final (T015)', () => {
    it('devuelve la Final guardada con su factura, sin consultar a Módulo 2 ni las cotizaciones (FR-004, BR-003)', async () => {
      const stored = finals.seed(finalSettlement({ roomId: ROOM_A }));
      const invoice = invoices.emit(stored);

      const result = await asModule1({ reservationRef: RESERVATION_REF, roomId: ROOM_A });

      expect(result).toEqual({
        kind: 'SINGLE',
        settlement: {
          settlementType: 'FINAL',
          reservationRef: RESERVATION_REF,
          roomId: ROOM_A,
          categoryRoom: 'DOBLE',
          channel: 'OTA',
          otaId: OTA_ID,
          currency: 'COP',
          breakdown: {
            baseLodgingAmount: '700000.00',
            dynamicAdjustmentAmount: '50000.00',
            lodgingAmount: '750000.00',
            otaCommissionPercentage: '15.00',
            otaCommissionAmount: '112500.00',
            netIncome: '637500.00',
          },
          invoice,
          generatedAt: stored.generatedAt,
        },
      });
      expect(invoices.calls).toEqual([stored.settlementId]);
      expect(reservations.calls).toEqual([]);
      expect(quotes.requests).toEqual([]);
    });

    it('una Final sin factura emitida todavía sale con invoice null', async () => {
      finals.seed(directFinalSettlement({ roomId: ROOM_A }));

      const settlement = singleOf(
        await asModule1({ reservationRef: RESERVATION_REF, roomId: ROOM_A }),
      );

      expect(settlement).toMatchObject({
        settlementType: 'FINAL',
        channel: 'DIRECT',
        otaId: null,
        invoice: null,
      });
    });

    it('la Final se encuentra aunque roomId llegue en mayúsculas (007 lo guarda en minúsculas)', async () => {
      finals.seed(finalSettlement({ roomId: ROOM_A }));

      const settlement = singleOf(
        await asModule1({ reservationRef: RESERVATION_REF, roomId: ROOM_A.toUpperCase() }),
      );

      expect(settlement.settlementType).toBe('FINAL');
      expect(settlement.roomId).toBe(ROOM_A);
    });

    it('la Final de otra habitación de la reserva no se devuelve: se calcula la informativa de la consultada', async () => {
      finals.seed(finalSettlement({ roomId: ROOM_B }));

      const settlement = singleOf(
        await asModule1({ reservationRef: RESERVATION_REF, roomId: ROOM_A }),
      );

      expect(settlement).toMatchObject({ settlementType: 'INFORMATIVE', roomId: ROOM_A });
    });
  });

  describe('la habitación aún no tuvo check-out: informativa (T016)', () => {
    it('reserva OTA: obtiene la reserva, pide sus quoteIds, elige por roomId y calcula el desglose (escenario 1)', async () => {
      reservations.respondWith(otaReservation({ quoteIds: [QUOTE_A, QUOTE_B] }));
      build([
        storedQuote(QUOTE_A, ROOM_A),
        storedQuote(QUOTE_B, ROOM_B, QUOTE_B_NIGHTS, '600000.00'),
      ]);

      const result = await asModule1({
        reservationRef: RESERVATION_REF,
        roomId: ROOM_B,
        correlationId: CORRELATION_ID,
      });

      expect(result).toEqual({
        kind: 'SINGLE',
        settlement: {
          settlementType: 'INFORMATIVE',
          reservationRef: RESERVATION_REF,
          roomId: ROOM_B,
          categoryRoom: null,
          channel: 'OTA',
          otaId: OTA_ID,
          currency: 'COP',
          breakdown: {
            baseLodgingAmount: '500000.00',
            dynamicAdjustmentAmount: '100000.00',
            lodgingAmount: '600000.00',
            otaCommissionPercentage: '15.00',
            otaCommissionAmount: '90000.00',
            netIncome: '510000.00',
          },
          invoice: null,
          generatedAt: CALCULATED_AT,
        },
      });
      expect(reservations.calls).toEqual([
        { reservationRef: RESERVATION_REF, correlationId: CORRELATION_ID },
      ]);
      expect(quotes.requests).toEqual([[QUOTE_A, QUOTE_B]]);
      expect(invoices.calls).toEqual([]);
    });

    it('canal directo: sin comisión, otaId null e ingreso neto igual al hospedaje (escenario 2, FR-007 de 007)', async () => {
      reservations.respondWith(directReservation());

      const settlement = singleOf(
        await asModule1({ reservationRef: RESERVATION_REF, roomId: ROOM_A }),
      );

      expect(settlement).toMatchObject({
        settlementType: 'INFORMATIVE',
        channel: 'DIRECT',
        otaId: null,
        categoryRoom: null,
        breakdown: {
          baseLodgingAmount: '700000.00',
          dynamicAdjustmentAmount: '50000.00',
          lodgingAmount: '750000.00',
          otaCommissionPercentage: null,
          otaCommissionAmount: '0.00',
          netIncome: '750000.00',
        },
      });
    });

    it('un canal distinto de OTA se trata como directo, igual que en Generar liquidación', async () => {
      reservations.respondWith(directReservation({ channel: 'WEB' }));

      const settlement = singleOf(
        await asModule1({ reservationRef: RESERVATION_REF, roomId: ROOM_A }),
      );

      expect(settlement.channel).toBe('DIRECT');
      expect(settlement.breakdown.otaCommissionPercentage).toBeNull();
    });

    it('coincide con la liquidación que guarda Generar liquidación con los mismos datos (FR-008, SC-008)', async () => {
      reservations.respondWith(otaReservation({ quoteIds: [QUOTE_A, QUOTE_B] }));
      build([
        storedQuote(QUOTE_A, ROOM_A),
        storedQuote(QUOTE_B, ROOM_B, QUOTE_B_NIGHTS, '600000.00'),
      ]);
      const informative = singleOf(
        await asModule1({ reservationRef: RESERVATION_REF, roomId: ROOM_B }),
      );

      const generated = await new GenerateSettlementService(
        reservations,
        quotes,
        new InMemorySettlementRepository(),
      ).generate(checkoutCommand({ roomId: ROOM_B, checkOutDate: '2026-12-22' }));

      expect(informative.breakdown).toEqual({
        baseLodgingAmount: generated.baseLodgingAmount,
        dynamicAdjustmentAmount: generated.dynamicAdjustmentAmount,
        lodgingAmount: generated.lodgingAmount,
        otaCommissionPercentage: generated.otaCommissionPercentage,
        otaCommissionAmount: generated.otaCommissionAmount,
        netIncome: generated.netIncome,
      });
      expect(informative).toMatchObject({
        channel: generated.channel,
        otaId: generated.otaId,
        currency: generated.currency,
      });
    });

    it('no guarda nada: la informativa nunca se inserta como liquidación (FR-011)', async () => {
      await asModule1({ reservationRef: RESERVATION_REF, roomId: ROOM_A });
      await asModule1({ reservationRef: RESERVATION_REF, roomId: ROOM_A });

      expect(finals.inserts).toBe(0);
      expect(finals.byStayId.size).toBe(0);
    });

    it('consultas repetidas con los mismos datos devuelven la misma informativa (FR-008)', async () => {
      const first = await asModule1({ reservationRef: RESERVATION_REF, roomId: ROOM_A });
      const second = await asModule1({ reservationRef: RESERVATION_REF, roomId: ROOM_A });

      expect(second).toEqual(first);
    });

    it('sin categoryRoom no es un parámetro inválido, y la informativa siempre lleva categoryRoom null', async () => {
      const settlement = singleOf(
        await asModule1({ reservationRef: RESERVATION_REF, roomId: ROOM_A }),
      );

      expect(settlement.categoryRoom).toBeNull();
    });

    it('si hubiera dos cotizaciones de la misma habitación, usa siempre la de menor quoteId, como 007', async () => {
      const otherQuoteA = 'a0000000-0000-4000-8000-000000000001';
      reservations.respondWith(otaReservation({ quoteIds: [QUOTE_A, otherQuoteA] }));
      build([
        storedQuote(QUOTE_A, ROOM_A),
        storedQuote(otherQuoteA, ROOM_A, QUOTE_B_NIGHTS, '600000.00'),
      ]);

      const settlement = singleOf(
        await asModule1({ reservationRef: RESERVATION_REF, roomId: ROOM_A }),
      );

      expect(settlement.breakdown.lodgingAmount).toBe('600000.00');
    });

    it('elige la cotización sin distinguir mayúsculas en roomId', async () => {
      build([storedQuote(QUOTE_A, ROOM_A.toUpperCase())]);

      const settlement = singleOf(
        await asModule1({ reservationRef: RESERVATION_REF, roomId: ROOM_A }),
      );

      expect(settlement.breakdown.lodgingAmount).toBe('750000.00');
    });
  });

  describe('errores del cálculo informativo, sin valores parciales (FR-012)', () => {
    it('reserva inexistente en Módulo 2 → RESERVATION_NOT_FOUND, sin pedir cotizaciones', async () => {
      reservations.respondWith(new ReservationNotFoundError(RESERVATION_REF));

      await expect(
        asModule1({ reservationRef: RESERVATION_REF, roomId: ROOM_A }),
      ).rejects.toBeInstanceOf(ReservationNotFoundError);
      expect(quotes.requests).toEqual([]);
    });

    it('Módulo 2 no disponible → MODULE2_UNAVAILABLE', async () => {
      reservations.respondWith(new Module2UnavailableError(RESERVATION_REF));

      await expect(
        asModule1({ reservationRef: RESERVATION_REF, roomId: ROOM_A }),
      ).rejects.toBeInstanceOf(Module2UnavailableError);
    });

    it('ninguna cotización de la reserva es de la habitación → QUOTE_NOT_FOUND', async () => {
      await expect(
        asModule1({ reservationRef: RESERVATION_REF, roomId: ROOM_B }),
      ).rejects.toBeInstanceOf(QuoteNotFoundError);
    });

    it('la reserva no tiene quoteIds → QUOTE_NOT_FOUND sin consultar cotizaciones', async () => {
      reservations.respondWith(otaReservation({ quoteIds: [] }));

      await expect(
        asModule1({ reservationRef: RESERVATION_REF, roomId: ROOM_A }),
      ).rejects.toBeInstanceOf(QuoteNotFoundError);
      expect(quotes.requests).toEqual([]);
    });

    it('reserva OTA sin comisión → MISSING_COMMISSION (escenario 3)', async () => {
      reservations.respondWith(otaReservation({ otaCommissionPercentage: null }));

      await expect(
        asModule1({ reservationRef: RESERVATION_REF, roomId: ROOM_A }),
      ).rejects.toBeInstanceOf(MissingCommissionError);
    });

    it('reserva OTA con comisión fuera de 0 a 100 → INVALID_COMMISSION (escenario 3)', async () => {
      reservations.respondWith(otaReservation({ otaCommissionPercentage: 150 }));

      await expect(
        asModule1({ reservationRef: RESERVATION_REF, roomId: ROOM_A }),
      ).rejects.toBeInstanceOf(InvalidCommissionError);
    });

    it('si falla la lectura de la Final, el error se propaga y no se calcula la informativa', async () => {
      jest
        .spyOn(finals, 'findByReservationAndRoom')
        .mockRejectedValueOnce(new Error('base de datos caída'));

      await expect(asModule1({ reservationRef: RESERVATION_REF, roomId: ROOM_A })).rejects.toThrow(
        'base de datos caída',
      );
      expect(reservations.calls).toEqual([]);
    });
  });

  describe('parámetros y actor (FR-013)', () => {
    it('sin roomId o con roomId que no es UUID → INVALID_QUERY_PARAMS sin consultar nada', async () => {
      await expect(asModule1({ reservationRef: RESERVATION_REF })).rejects.toBeInstanceOf(
        InvalidSettlementQueryError,
      );
      await expect(
        asModule1({ reservationRef: RESERVATION_REF, roomId: 'habitacion-1' }),
      ).rejects.toBeInstanceOf(InvalidSettlementQueryError);
      await expect(asModule1({ roomId: ROOM_A })).rejects.toBeInstanceOf(
        InvalidSettlementQueryError,
      );

      expect(reservations.calls).toEqual([]);
      expect(invoices.calls).toEqual([]);
    });

    it('la OTA nunca recibe una informativa ni hace consultar a Módulo 2 (BR-002)', async () => {
      await expect(
        service.execute(
          { reservationRef: RESERVATION_REF, roomId: ROOM_A },
          {
            kind: 'OTA',
            otaId: OTA_ID,
          },
        ),
      ).rejects.toBeInstanceOf(SettlementNotFoundError);
      expect(reservations.calls).toEqual([]);
      expect(quotes.requests).toEqual([]);
    });
  });
});
