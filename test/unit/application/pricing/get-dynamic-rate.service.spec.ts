// Feature 005 · Consultar tarifa dinámica (T008–T010, T015–T017, T021, T032–T034, T039, T042)
import { DynamicRateAccessDeniedError } from '../../../../src/domain/errors/pricing/dynamic-rate-access-denied.error';
import { InvalidBaseRateError } from '../../../../src/domain/errors/pricing/invalid-base-rate.error';
import { InvalidDateRangeError } from '../../../../src/domain/errors/pricing/invalid-date-range.error';
import { InvalidPricingRequestError } from '../../../../src/domain/errors/pricing/invalid-pricing-request.error';
import { Module1UnavailableError } from '../../../../src/domain/errors/pricing/module1-unavailable.error';
import { RoomNotFoundError } from '../../../../src/domain/errors/pricing/room-not-found.error';
import { SeasonCalendarUnavailableError } from '../../../../src/domain/errors/pricing/season-calendar-unavailable.error';
import { SeasonConfigurationInconsistentError } from '../../../../src/domain/errors/pricing/season-configuration-inconsistent.error';
import { SeasonRulesUnavailableError } from '../../../../src/domain/errors/pricing/season-rules-unavailable.error';
import { Module2UnavailableError } from '../../../../src/domain/errors/settlement/module2-unavailable.error';
import { LodgingQuote } from '../../../../src/domain/model/pricing/lodging-quote';
import { ReservationData } from '../../../../src/domain/model/settlement/reservation-data';
import {
  DynamicRateCalculator,
  NIGHTS_IN_PARALLEL,
} from '../../../../src/application/services/pricing/dynamic-rate-calculator';
import { GetDynamicRateService } from '../../../../src/application/services/pricing/get-dynamic-rate.service';
import {
  DynamicRateCaller,
  DynamicRateQuery,
  DynamicRateResult,
} from '../../../../src/domain/ports/in/pricing/get-dynamic-rate.use-case';
import {
  ALTA_ID,
  BAJA_ID,
  FakeBaseRates,
  FakeReservationClient,
  FakeSeasonCalendar,
  FakeSeasonRules,
  InMemoryLodgingQuoteRepository,
  REGULAR_ID,
} from '../../../support/pricing/fake-dynamic-rate-ports';

const ROOM_ID = '3f2b8c1e-5a47-4d09-9b6e-1c2d3e4f5a6b';
const NOW = new Date('2026-11-04T15:00:00.000Z');

// Resultado plano, como lo ve quien consulta.
function plain(result: DynamicRateResult) {
  return {
    roomId: result.roomId,
    currency: result.currency,
    nights: result.nights.map((night) => ({
      date: night.date.toString(),
      baseRate: night.baseRate.toString(),
      seasonName: night.seasonName,
      seasonAdjustmentPercent: night.adjustmentPercent.toString(),
      dynamicRate: night.dynamicRate.toString(),
    })),
    total: result.total.toString(),
  };
}

describe('GetDynamicRateService', () => {
  let baseRates: FakeBaseRates;
  let rules: FakeSeasonRules;
  let calendar: FakeSeasonCalendar;
  let reservations: FakeReservationClient;
  let quotes: InMemoryLodgingQuoteRepository;
  let service: GetDynamicRateService;

  beforeEach(() => {
    baseRates = new FakeBaseRates();
    rules = new FakeSeasonRules();
    calendar = new FakeSeasonCalendar();
    reservations = new FakeReservationClient();
    quotes = new InMemoryLodgingQuoteRepository();
    service = new GetDynamicRateService(
      new DynamicRateCalculator(baseRates, rules, calendar, () => NOW),
      reservations,
      quotes,
    );
  });

  const query = (extra: DynamicRateQuery): DynamicRateQuery => ({ roomId: ROOM_ID, ...extra });

  function expectNoPortCalls(): void {
    expect(baseRates.calls).toHaveLength(0);
    expect(rules.calls).toHaveLength(0);
    expect(calendar.calls).toHaveLength(0);
  }

  describe('una noche (HU1)', () => {
    it('combina la tarifa base de 004, la temporada de 011 y el ajuste de 009 (T008)', async () => {
      calendar.assign(['2026-12-24'], ALTA_ID);

      const result = await service.execute(query({ date: '2026-12-24' }));

      expect(plain(result)).toEqual({
        roomId: ROOM_ID,
        currency: 'COP',
        nights: [
          {
            date: '2026-12-24',
            baseRate: '300000.00',
            seasonName: 'Alta',
            seasonAdjustmentPercent: '20.00',
            dynamicRate: '360000.00',
          },
        ],
        total: '360000.00',
      });
      expect(baseRates.calls).toEqual([{ roomId: ROOM_ID, date: '2026-12-24' }]);
      expect(calendar.calls).toEqual([{ date: '2026-12-24', asOf: NOW }]);
      expect(rules.calls).toEqual([NOW]);
    });

    it.each(['0.00', '10.00'])(
      'sin clasificación usa el ajuste vigente de la temporada por defecto (%s), sin suponer cero (T009)',
      async (defaultAdjustment) => {
        rules.setAdjustment(REGULAR_ID, defaultAdjustment);

        const result = await service.execute(query({ date: '2026-07-15' }));

        const expected = defaultAdjustment === '0.00' ? '300000.00' : '330000.00';
        expect(plain(result).nights[0]).toMatchObject({
          seasonName: 'Regular',
          seasonAdjustmentPercent: defaultAdjustment,
          dynamicRate: expected,
        });
      },
    );

    it('falla si el calendario usa una temporada que no está en el catálogo, sin usar otra ni ajuste cero (T010)', async () => {
      calendar.assign(['2026-12-24'], '99999999-9999-4999-8999-999999999999');

      await expect(service.execute(query({ date: '2026-12-24' }))).rejects.toThrow(
        SeasonConfigurationInconsistentError,
      );
    });

    it('date equivale a checkInDate = date y checkOutDate = date + 1 día (T042)', async () => {
      calendar.assign(['2026-12-31'], ALTA_ID);

      const single = await service.execute(query({ date: '2026-12-31' }));
      const range = await service.execute(
        query({ checkInDate: '2026-12-31', checkOutDate: '2027-01-01' }),
      );

      expect(plain(single)).toEqual(plain(range));
      expect(single.nights).toHaveLength(1);
    });
  });

  describe('rango de noches (HU2)', () => {
    it('cada noche usa su propia temporada y el total es la suma exacta (T015, BR-003)', async () => {
      calendar.assign(['2026-12-20', '2026-12-21'], BAJA_ID);
      calendar.assign(['2026-12-24', '2026-12-25'], ALTA_ID);
      baseRates.rates.set('2026-12-25', '333333.33');

      const result = await service.execute(
        query({ checkInDate: '2026-12-20', checkOutDate: '2026-12-26' }),
      );

      expect(plain(result).nights.map((n) => [n.date, n.seasonName, n.dynamicRate])).toEqual([
        ['2026-12-20', 'Baja', '270000.00'],
        ['2026-12-21', 'Baja', '270000.00'],
        ['2026-12-22', 'Regular', '300000.00'],
        ['2026-12-23', 'Regular', '300000.00'],
        ['2026-12-24', 'Alta', '360000.00'],
        // 333333.33 × 1.20 = 399999.996 → 400000.00
        ['2026-12-25', 'Alta', '400000.00'],
      ]);
      expect(result.total.toString()).toBe('1900000.00');
    });

    it('usa un solo snapshot de reglas y el mismo asOf para todas las noches', async () => {
      await service.execute(query({ checkInDate: '2026-12-20', checkOutDate: '2026-12-30' }));

      expect(rules.calls).toEqual([NOW]);
      expect(calendar.calls).toHaveLength(10);
      expect(calendar.calls.every((call) => call.asOf === NOW)).toBe(true);
    });

    it(`consulta a lo sumo ${NIGHTS_IN_PARALLEL} noches a la vez (T019)`, async () => {
      await service.execute(query({ checkInDate: '2026-12-01', checkOutDate: '2026-12-31' }));

      expect(baseRates.calls).toHaveLength(30);
      expect(baseRates.maxInFlight).toBeGreaterThan(1);
      expect(baseRates.maxInFlight).toBeLessThanOrEqual(NIGHTS_IN_PARALLEL);
    });

    it.each([
      ['habitación no encontrada', new RoomNotFoundError()],
      ['tarifa base menor o igual a cero', new InvalidBaseRateError()],
      ['Módulo 1 no disponible', new Module1UnavailableError(new Error('timeout'))],
    ])(
      'si una noche falla (%s), falla la consulta completa sin noches parciales (T017)',
      async (_, failure) => {
        baseRates.failures.set('2026-12-24', failure);

        await expect(
          service.execute(query({ checkInDate: '2026-12-23', checkOutDate: '2026-12-26' })),
        ).rejects.toBe(failure);
      },
    );

    it('tras el primer fallo no empieza noches nuevas (fail-fast)', async () => {
      baseRates.failures.set('2026-12-01', new Module1UnavailableError(new Error('caído')));

      await expect(
        service.execute(query({ checkInDate: '2026-12-01', checkOutDate: '2026-12-31' })),
      ).rejects.toThrow(Module1UnavailableError);
      expect(baseRates.calls.length).toBeLessThanOrEqual(NIGHTS_IN_PARALLEL);
    });

    it.each([
      ['las reglas de 009', () => (rules.failure = new SeasonRulesUnavailableError(new Error()))],
      ['el calendario de 011', () => (calendar.failure = new SeasonCalendarUnavailableError())],
    ])('propaga el error si no se pueden leer %s', async (_, breakIt) => {
      breakIt();

      await expect(service.execute(query({ date: '2026-12-24' }))).rejects.toBeDefined();
    });
  });

  describe('validación antes de llamar a cualquier puerto (T016, T021)', () => {
    it.each([
      ['salida igual a la entrada', '2026-12-24', '2026-12-24'],
      ['salida anterior a la entrada', '2026-12-26', '2026-12-23'],
    ])('%s → InvalidDateRangeError', async (_, checkInDate, checkOutDate) => {
      await expect(service.execute(query({ checkInDate, checkOutDate }))).rejects.toThrow(
        InvalidDateRangeError,
      );
      expectNoPortCalls();
    });

    it.each<[string, DynamicRateQuery]>([
      ['sin roomId', { date: '2026-12-24' }],
      ['roomId que no es UUID', { roomId: 'habitacion-101', date: '2026-12-24' }],
      ['sin fechas', { roomId: ROOM_ID }],
      [
        'date junto con el rango',
        {
          roomId: ROOM_ID,
          date: '2026-12-24',
          checkInDate: '2026-12-24',
          checkOutDate: '2026-12-25',
        },
      ],
      ['solo checkInDate', { roomId: ROOM_ID, checkInDate: '2026-12-24' }],
      ['solo checkOutDate', { roomId: ROOM_ID, checkOutDate: '2026-12-25' }],
      ['fecha que no existe', { roomId: ROOM_ID, date: '2026-02-30' }],
      ['fecha con otro formato', { roomId: ROOM_ID, date: '24/12/2026' }],
    ])('%s → InvalidPricingRequestError (INVALID_QUERY_PARAMS)', async (_, badQuery) => {
      const error = await service.execute(badQuery).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(InvalidPricingRequestError);
      expect((error as InvalidPricingRequestError).errorCode).toBe('INVALID_QUERY_PARAMS');
      expectNoPortCalls();
    });
  });

  describe('acceso de la OTA (HU4)', () => {
    const OTA: DynamicRateCaller = { kind: 'OTA', otaId: 'booking' };
    const RESERVATION_REF = 'RES-000123';
    const QUOTE_ID = 'a1f2c3d4-e5b6-4789-8a9b-0c1d2e3f4a5b';
    const OTHER_ROOM_ID = '7c6b5a49-3827-4615-a4b3-c2d1e0f9a8b7';

    // Cotización guardada de una habitación (lo que Módulo 2 guardó al crear la reserva).
    function storeQuote(roomId: string): void {
      quotes.quotes.set(
        QUOTE_ID,
        LodgingQuote.restore({
          quoteId: QUOTE_ID,
          roomId,
          checkInDate: '2026-12-23',
          checkOutDate: '2026-12-24',
          currency: 'COP',
          lodgingAmount: '300000.00',
          nights: [
            {
              date: '2026-12-23',
              baseRate: '300000.00',
              seasonName: 'Regular',
              adjustmentPercent: '0.00',
              rate: '300000.00',
            },
          ],
        }),
      );
    }

    // Reserva de Módulo 2 intermediada por la OTA del token (contrato CLIENT-get-reservation).
    function reservation(changes: Partial<ReservationData> = {}): ReservationData {
      return {
        reservationRef: RESERVATION_REF,
        quoteIds: [QUOTE_ID],
        channel: 'OTA',
        otaId: 'booking',
        otaConfirmationCode: 'BK-778899',
        otaCommissionPercentage: '15.00',
        ...changes,
      };
    }

    const otaQuery = (changes: DynamicRateQuery = {}): DynamicRateQuery =>
      query({
        checkInDate: '2026-12-23',
        checkOutDate: '2026-12-26',
        reservationRef: RESERVATION_REF,
        ...changes,
      });

    beforeEach(() => {
      calendar.assign(['2026-12-24', '2026-12-25'], ALTA_ID);
      storeQuote(ROOM_ID);
      reservations.reservations.set(RESERVATION_REF, reservation());
    });

    it('habitación de una reserva propia: el mismo resultado que obtiene Módulo 2 (T032, FR-011)', async () => {
      const asOta = plain(await service.execute(otaQuery(), OTA));
      const asModule2 = plain(await service.execute(otaQuery()));

      expect(asOta).toEqual(asModule2);
      expect(asOta.total).toBe('1020000.00');
      expect(reservations.calls).toEqual([RESERVATION_REF]);
    });

    it('reconoce la habitación aunque el roomId llegue en mayúsculas', async () => {
      const result = await service.execute(otaQuery({ roomId: ROOM_ID.toUpperCase() }), OTA);

      expect(result.total.toString()).toBe('1020000.00');
    });

    it.each<[string, () => void]>([
      [
        'reserva de otra OTA',
        () => reservations.reservations.set(RESERVATION_REF, reservation({ otaId: 'expedia' })),
      ],
      [
        'reserva del canal directo',
        () =>
          reservations.reservations.set(
            RESERVATION_REF,
            reservation({ channel: null, otaId: undefined, otaConfirmationCode: undefined }),
          ),
      ],
      [
        // El canal manda aunque llegue el otaId de esta OTA.
        'reserva de un canal que no es OTA con el otaId de la OTA',
        () => reservations.reservations.set(RESERVATION_REF, reservation({ channel: 'DIRECT' })),
      ],
      [
        'reserva que no incluye la habitación consultada',
        () => {
          quotes.quotes.clear();
          storeQuote(OTHER_ROOM_ID);
        },
      ],
      [
        'reserva sin cotizaciones',
        () => reservations.reservations.set(RESERVATION_REF, reservation({ quoteIds: [] })),
      ],
      ['cotización de la reserva que no existe', () => quotes.quotes.clear()],
      ['reserva inexistente (404 de Módulo 2)', () => reservations.reservations.clear()],
    ])(
      '%s → DynamicRateAccessDeniedError con el mismo mensaje, sin llamar a 004, 009 ni 011 (T033)',
      async (_, prepare) => {
        prepare();

        const error = await service.execute(otaQuery(), OTA).catch((e: unknown) => e);

        expect(error).toBeInstanceOf(DynamicRateAccessDeniedError);
        expect((error as DynamicRateAccessDeniedError).errorCode).toBe('FORBIDDEN');
        expect((error as Error).message).toBe(new DynamicRateAccessDeniedError().message);
        expectNoPortCalls();
      },
    );

    it('un token de OTA sin otaId no coincide con ninguna reserva', async () => {
      await expect(service.execute(otaQuery(), { kind: 'OTA', otaId: '' })).rejects.toThrow(
        DynamicRateAccessDeniedError,
      );
      expectNoPortCalls();
    });

    it('Módulo 2 no responde: la consulta falla completa, sin llamar a 004, 009 ni 011 (T034)', async () => {
      const failure = new Module2UnavailableError(RESERVATION_REF);
      reservations.failure = failure;

      await expect(service.execute(otaQuery(), OTA)).rejects.toBe(failure);
      expectNoPortCalls();
    });

    it.each([
      ['sin reservationRef', undefined],
      ['reservationRef vacío', '  '],
    ])('%s → INVALID_QUERY_PARAMS sin consultar a Módulo 2', async (_, reservationRef) => {
      const error = await service
        .execute(otaQuery({ reservationRef }), OTA)
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(InvalidPricingRequestError);
      expect(reservations.calls).toHaveLength(0);
      expectNoPortCalls();
    });

    it('el rango se valida antes de consultar a Módulo 2 (contrato GET, regla 1)', async () => {
      await expect(
        service.execute(otaQuery({ checkInDate: '2026-12-26', checkOutDate: '2026-12-23' }), OTA),
      ).rejects.toThrow(InvalidDateRangeError);
      expect(reservations.calls).toHaveLength(0);
    });

    it('Módulo 2 (sin token) no consulta la reserva y se ignora reservationRef (T034)', async () => {
      reservations.reservations.clear();

      const result = await service.execute(otaQuery());

      expect(result.total.toString()).toBe('1020000.00');
      expect(reservations.calls).toHaveLength(0);
    });
  });

  it('es determinista: la misma consulta con la misma configuración da lo mismo (T039)', async () => {
    calendar.assign(['2026-12-24'], ALTA_ID);
    const sameQuery = query({ checkInDate: '2026-12-23', checkOutDate: '2026-12-26' });

    const first = plain(await service.execute(sameQuery));
    const second = plain(await service.execute(sameQuery));

    expect(second).toEqual(first);
  });

  it('refleja la configuración vigente en cada consulta, sin caché (T040)', async () => {
    calendar.assign(['2026-12-24'], ALTA_ID);
    const before = await service.execute(query({ date: '2026-12-24' }));
    rules.setAdjustment(ALTA_ID, '25.00');
    baseRates.defaultRate = '310000.00';

    const after = await service.execute(query({ date: '2026-12-24' }));

    expect(before.total.toString()).toBe('360000.00');
    expect(after.total.toString()).toBe('387500.00');
  });
});
