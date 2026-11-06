// Feature 005 · Consultar tarifa dinámica (T008–T010, T015–T017, T021, T039, T042)
import { InvalidBaseRateError } from '../../../../src/domain/errors/pricing/invalid-base-rate.error';
import { InvalidDateRangeError } from '../../../../src/domain/errors/pricing/invalid-date-range.error';
import { InvalidPricingRequestError } from '../../../../src/domain/errors/pricing/invalid-pricing-request.error';
import { Module1UnavailableError } from '../../../../src/domain/errors/pricing/module1-unavailable.error';
import { RoomNotFoundError } from '../../../../src/domain/errors/pricing/room-not-found.error';
import { SeasonCalendarUnavailableError } from '../../../../src/domain/errors/pricing/season-calendar-unavailable.error';
import { SeasonConfigurationInconsistentError } from '../../../../src/domain/errors/pricing/season-configuration-inconsistent.error';
import { SeasonRulesUnavailableError } from '../../../../src/domain/errors/pricing/season-rules-unavailable.error';
import {
  DynamicRateCalculator,
  NIGHTS_IN_PARALLEL,
} from '../../../../src/application/services/pricing/dynamic-rate-calculator';
import { GetDynamicRateService } from '../../../../src/application/services/pricing/get-dynamic-rate.service';
import {
  DynamicRateQuery,
  DynamicRateResult,
} from '../../../../src/domain/ports/in/pricing/get-dynamic-rate.use-case';
import {
  ALTA_ID,
  BAJA_ID,
  FakeBaseRates,
  FakeSeasonCalendar,
  FakeSeasonRules,
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
  let service: GetDynamicRateService;

  beforeEach(() => {
    baseRates = new FakeBaseRates();
    rules = new FakeSeasonRules();
    calendar = new FakeSeasonCalendar();
    service = new GetDynamicRateService(
      new DynamicRateCalculator(baseRates, rules, calendar, () => NOW),
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
