// Feature 007 · Generar liquidación (T014, T023, T026, T029)
import { GenerateSettlementService } from '../../../../src/application/services/settlement/generate-settlement.service';
import { InvalidCheckoutDataError } from '../../../../src/domain/errors/settlement/invalid-checkout-data.error';
import { InvalidCommissionError } from '../../../../src/domain/errors/settlement/invalid-commission.error';
import { MissingCommissionError } from '../../../../src/domain/errors/settlement/missing-commission.error';
import { Module2UnavailableError } from '../../../../src/domain/errors/settlement/module2-unavailable.error';
import { QuoteNotFoundError } from '../../../../src/domain/errors/settlement/quote-not-found.error';
import { ReservationNotFoundError } from '../../../../src/domain/errors/settlement/reservation-not-found.error';
import { SettlementAlreadyExistsError } from '../../../../src/domain/errors/settlement/settlement-already-exists.error';
import { LodgingQuote } from '../../../../src/domain/model/pricing/lodging-quote';
import { Settlement } from '../../../../src/domain/model/settlement/settlement';
import {
  checkoutCommand,
  directReservation,
  EVENT_ID,
  FakeReservationClient,
  InMemoryLodgingQuotes,
  InMemorySettlementRepository,
  otaReservation,
  QUOTE_A,
  QUOTE_B,
  RESERVATION_REF,
  ROOM_A,
  ROOM_B,
  STAY_ID,
  storedQuote,
} from '../../../support/settlement/fake-settlement-ports';

const OTHER_STAY = 'd4b0f2c3-6a5e-4f7b-9c8d-2e3f4a5b6c7d';

describe('GenerateSettlementService', () => {
  let reservations: FakeReservationClient;
  let quotes: InMemoryLodgingQuotes;
  let settlements: InMemorySettlementRepository;
  let ids: string[];

  function service(quoteList?: LodgingQuote[]): GenerateSettlementService {
    quotes = new InMemoryLodgingQuotes(quoteList);
    return new GenerateSettlementService(reservations, quotes, settlements, () => {
      const id = ids.shift();
      if (!id) throw new Error('sin ids de prueba');
      return id;
    });
  }

  beforeEach(() => {
    reservations = new FakeReservationClient();
    settlements = new InMemorySettlementRepository();
    ids = ['4e2b8c1d-9a7f-4f3e-b6d5-0c1a2b3d4e5f', '5f3c9d2e-0b8a-4a4f-87e6-1d2b3c4e5f6a'];
  });

  describe('HU1 — liquidación Final al registrar el check-out', () => {
    it('canal directo: guarda una liquidación Final con ingreso neto = hospedaje de la cotización', async () => {
      const settlement = await service().generate(checkoutCommand());

      expect(settlement.status).toBe('FINAL');
      expect(settlement.channel).toBe('DIRECT');
      expect(settlement.quoteId).toBe(QUOTE_A);
      expect(settlement.lodgingAmount).toBe('750000.00');
      expect(settlement.otaCommissionAmount).toBe('0.00');
      expect(settlement.netIncome).toBe('750000.00');
      expect(settlement.sourceEventId).toBe(EVENT_ID);
      expect(settlements.inserts).toBe(1);
    });

    it('consulta la reserva a Módulo 2 con el eventId como X-Correlation-Id', async () => {
      await service().generate(checkoutCommand());

      expect(reservations.calls).toEqual([
        { reservationRef: RESERVATION_REF, correlationId: EVENT_ID },
      ]);
    });

    it('dos habitaciones del mismo tipo: cada una usa la cotización de su roomId, no la del tipo (FR-020)', async () => {
      reservations.respondWith(directReservation({ quoteIds: [QUOTE_A, QUOTE_B] }));
      const generator = service([
        storedQuote(QUOTE_A, ROOM_A),
        storedQuote(QUOTE_B, ROOM_B, [['2026-12-20', '180000.00', '180000.00']], '180000.00'),
      ]);

      const roomA = await generator.generate(checkoutCommand({ roomId: ROOM_A }));
      const roomB = await generator.generate(
        checkoutCommand({ stayId: OTHER_STAY, roomId: ROOM_B }),
      );

      expect([roomA.quoteId, roomA.netIncome]).toEqual([QUOTE_A, '750000.00']);
      expect([roomB.quoteId, roomB.netIncome]).toEqual([QUOTE_B, '180000.00']);
      expect(roomA.categoryRoom).toBe(roomB.categoryRoom);
      expect(settlements.byStayId.size).toBe(2);
    });

    it('elige la cotización aunque el roomId del check-out llegue en mayúsculas', async () => {
      const settlement = await service().generate(
        checkoutCommand({ roomId: ROOM_A.toUpperCase() }),
      );

      expect(settlement.quoteId).toBe(QUOTE_A);
      expect(settlement.roomId).toBe(ROOM_A);
    });

    it('varias cotizaciones de la misma habitación: siempre la de menor quoteId (NFR-001)', async () => {
      const higher = 'f0000000-0000-4000-8000-000000000002';
      const lower = '00000000-0000-4000-8000-000000000001';
      reservations.respondWith(directReservation({ quoteIds: [higher, lower] }));

      const settlement = await service([
        storedQuote(higher, ROOM_A),
        storedQuote(lower, ROOM_A, [['2026-12-20', '100000.00', '100000.00']], '100000.00'),
      ]).generate(checkoutCommand());

      expect(settlement.quoteId).toBe(lower);
      expect(settlement.lodgingAmount).toBe('100000.00');
    });

    it('salida anticipada: guarda las fechas reales pero cobra el valor de la cotización (BR-004)', async () => {
      const settlement = await service().generate(
        checkoutCommand({ checkInDate: '2026-12-20', checkOutDate: '2026-12-21' }),
      );

      expect(settlement.checkOutDate).toBe('2026-12-21');
      expect(settlement.lodgingAmount).toBe('750000.00');
    });

    it('reenvío idéntico: devuelve la existente sin llamar a Módulo 2 ni recalcular (FR-011)', async () => {
      const generator = service();
      const first = await generator.generate(checkoutCommand());
      reservations.respondWith(new Error('no se debe consultar'));

      const second = await generator.generate(checkoutCommand());

      expect(second).toBe(first);
      expect(reservations.calls).toHaveLength(1);
      expect(quotes.requests).toHaveLength(1);
      expect(settlements.inserts).toBe(1);
    });

    it('reserva inexistente en Módulo 2 → RESERVATION_NOT_FOUND y no guarda nada', async () => {
      reservations.respondWith(new ReservationNotFoundError(RESERVATION_REF));

      await expect(service().generate(checkoutCommand())).rejects.toBeInstanceOf(
        ReservationNotFoundError,
      );
      expect(settlements.inserts).toBe(0);
    });

    it('Módulo 2 caído → MODULE2_UNAVAILABLE (reintentable) y no guarda nada (FR-021)', async () => {
      reservations.respondWith(new Module2UnavailableError(RESERVATION_REF));

      await expect(service().generate(checkoutCommand())).rejects.toBeInstanceOf(
        Module2UnavailableError,
      );
      expect(settlements.inserts).toBe(0);
    });

    it.each([
      ['la reserva no tiene cotizaciones', [], [storedQuote(QUOTE_A, ROOM_A)]],
      ['ninguna cotización es de la habitación', [QUOTE_B], [storedQuote(QUOTE_B, ROOM_B)]],
      ['el quoteId de la reserva no existe en Módulo 3', [QUOTE_A], []],
    ])('%s → QUOTE_NOT_FOUND y no guarda nada', async (_label, quoteIds, quoteList) => {
      reservations.respondWith(directReservation({ quoteIds }));

      const generation = service(quoteList).generate(checkoutCommand());

      await expect(generation).rejects.toBeInstanceOf(QuoteNotFoundError);
      await expect(generation).rejects.toThrow(new RegExp(`${RESERVATION_REF}.*${ROOM_A}`));
      expect(settlements.inserts).toBe(0);
    });

    it('no pide cotizaciones si la reserva no tiene ninguna', async () => {
      reservations.respondWith(directReservation({ quoteIds: [] }));

      await expect(service().generate(checkoutCommand())).rejects.toBeInstanceOf(
        QuoteNotFoundError,
      );
      expect(quotes.requests).toEqual([]);
    });

    it('comando inválido → INVALID_CHECKOUT_EVENT antes de tocar Módulo 2 o la base (BR-007)', async () => {
      const findByStayId = jest.spyOn(settlements, 'findByStayId');

      await expect(
        service().generate(
          checkoutCommand({ checkInDate: '2026-12-23', checkOutDate: '2026-12-20' }),
        ),
      ).rejects.toBeInstanceOf(InvalidCheckoutDataError);
      expect(findByStayId).not.toHaveBeenCalled();
      expect(reservations.calls).toEqual([]);
    });
  });

  describe('HU2 — comisión OTA', () => {
    it('OTA con 15 %: guarda la OTA, su código, el porcentaje, la comisión y el neto', async () => {
      reservations.respondWith(otaReservation());

      const settlement = await service().generate(checkoutCommand());

      expect(settlement).toMatchObject({
        channel: 'OTA',
        otaId: 'booking',
        otaConfirmationCode: 'BKG-88421',
        otaCommissionPercentage: '15.00',
        otaCommissionAmount: '112500.00',
        netIncome: '637500.00',
      });
    });

    it('OTA sin porcentaje → MISSING_COMMISSION y no guarda nada', async () => {
      reservations.respondWith(otaReservation({ otaCommissionPercentage: undefined }));

      await expect(service().generate(checkoutCommand())).rejects.toBeInstanceOf(
        MissingCommissionError,
      );
      expect(settlements.inserts).toBe(0);
    });

    it.each([-1, 120])(
      'OTA con %s %% → INVALID_COMMISSION y no guarda nada',
      async (percentage) => {
        reservations.respondWith(otaReservation({ otaCommissionPercentage: percentage }));

        await expect(service().generate(checkoutCommand())).rejects.toBeInstanceOf(
          InvalidCommissionError,
        );
        expect(settlements.inserts).toBe(0);
      },
    );

    it('reserva sin canal → directo, sin comisión aunque traiga un porcentaje', async () => {
      reservations.respondWith(directReservation({ otaCommissionPercentage: 15 }));

      const settlement = await service().generate(checkoutCommand());

      expect(settlement.channel).toBe('DIRECT');
      expect(settlement.otaCommissionPercentage).toBeNull();
      expect(settlement.netIncome).toBe(settlement.lodgingAmount);
    });

    it('la cotización se valida antes que la comisión: sin cotización → QUOTE_NOT_FOUND', async () => {
      reservations.respondWith(otaReservation({ quoteIds: [], otaCommissionPercentage: null }));

      await expect(service().generate(checkoutCommand())).rejects.toBeInstanceOf(
        QuoteNotFoundError,
      );
    });
  });

  describe('HU3 — una sola liquidación por estancia', () => {
    it.each([
      ['otra fecha de salida', { checkOutDate: '2026-12-24' }, 'checkOutDate'],
      ['otra habitación', { roomId: ROOM_B }, 'roomId'],
      ['otra reserva', { reservationRef: 'RES-999999' }, 'reservationRef'],
      ['otro tipo de habitación', { categoryRoom: 'SUITE' }, 'categoryRoom'],
    ])(
      'mismo stayId con %s → SETTLEMENT_ALREADY_EXISTS y la original intacta (FR-010)',
      async (_label, overrides, field) => {
        const generator = service();
        const original = await generator.generate(checkoutCommand());

        const attempt = generator.generate(checkoutCommand(overrides));

        await expect(attempt).rejects.toBeInstanceOf(SettlementAlreadyExistsError);
        await expect(attempt).rejects.toThrow(new RegExp(`${STAY_ID}.*${field}`));
        expect(await settlements.findByStayId(STAY_ID)).toBe(original);
        expect(settlements.inserts).toBe(1);
      },
    );

    it('otra entrega idéntica guardó primero (UNIQUE(stay_id)) → devuelve la que quedó (FR-011)', async () => {
      const generator = service();
      const winner = await new GenerateSettlementService(
        new FakeReservationClient(),
        new InMemoryLodgingQuotes(),
        new InMemorySettlementRepository(),
        () => '0f0f0f0f-0000-4000-8000-000000000000',
      ).generate(checkoutCommand());
      settlements.saveConcurrentlyBeforeNextInsert(winner);

      const result = await generator.generate(checkoutCommand());

      expect(result.settlementId).toBe(winner.settlementId);
      expect(settlements.byStayId.size).toBe(1);
    });

    it('otra entrega con datos distintos guardó primero → SETTLEMENT_ALREADY_EXISTS', async () => {
      const winner: Settlement = await new GenerateSettlementService(
        new FakeReservationClient(),
        new InMemoryLodgingQuotes(),
        new InMemorySettlementRepository(),
        () => '0f0f0f0f-0000-4000-8000-000000000000',
      ).generate(checkoutCommand({ checkOutDate: '2026-12-22' }));
      settlements.saveConcurrentlyBeforeNextInsert(winner);

      await expect(service().generate(checkoutCommand())).rejects.toBeInstanceOf(
        SettlementAlreadyExistsError,
      );
      expect((await settlements.findByStayId(STAY_ID))?.settlementId).toBe(winner.settlementId);
    });
  });

  it('es determinista: el mismo check-out con la misma reserva y cotización da el mismo desglose (NFR-001)', async () => {
    reservations.respondWith(otaReservation());
    const first = await service().generate(checkoutCommand());
    settlements = new InMemorySettlementRepository();

    const second = await service().generate(checkoutCommand());

    const { settlementId: _a, generatedAt: _b, ...firstData } = first;
    const { settlementId: _c, generatedAt: _d, ...secondData } = second;
    expect(secondData).toEqual(firstData);
  });
});
