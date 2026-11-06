// Feature 005 · Consultar tarifa dinámica (T023, T024)
import { CreateLodgingQuoteService } from '../../../../src/application/services/pricing/create-lodging-quote.service';
import { DynamicRateCalculator } from '../../../../src/application/services/pricing/dynamic-rate-calculator';
import { GetDynamicRateService } from '../../../../src/application/services/pricing/get-dynamic-rate.service';
import { InvalidBaseRateError } from '../../../../src/domain/errors/pricing/invalid-base-rate.error';
import { InvalidDateRangeError } from '../../../../src/domain/errors/pricing/invalid-date-range.error';
import { InvalidPricingRequestError } from '../../../../src/domain/errors/pricing/invalid-pricing-request.error';
import { Module1UnavailableError } from '../../../../src/domain/errors/pricing/module1-unavailable.error';
import { RoomNotFoundError } from '../../../../src/domain/errors/pricing/room-not-found.error';
import { CreateLodgingQuoteCommand } from '../../../../src/domain/ports/in/pricing/create-lodging-quote.use-case';
import {
  ALTA_ID,
  FakeBaseRates,
  FakeSeasonCalendar,
  FakeSeasonRules,
  InMemoryLodgingQuoteRepository,
} from '../../../support/pricing/fake-dynamic-rate-ports';

const ROOM_ID = '3f2b8c1e-5a47-4d09-9b6e-1c2d3e4f5a6b';
const QUOTE_ID = 'a1f2c3d4-e5b6-4789-8a9b-0c1d2e3f4a5b';
const NOW = new Date('2026-11-04T15:00:00.000Z');

const STAY: CreateLodgingQuoteCommand = {
  roomId: ROOM_ID,
  checkInDate: '2026-12-23',
  checkOutDate: '2026-12-26',
};

describe('CreateLodgingQuoteService', () => {
  let baseRates: FakeBaseRates;
  let rules: FakeSeasonRules;
  let calendar: FakeSeasonCalendar;
  let quotes: InMemoryLodgingQuoteRepository;
  let calculator: DynamicRateCalculator;
  let service: CreateLodgingQuoteService;

  beforeEach(() => {
    baseRates = new FakeBaseRates();
    rules = new FakeSeasonRules();
    calendar = new FakeSeasonCalendar();
    calendar.assign(['2026-12-24', '2026-12-25'], ALTA_ID);
    quotes = new InMemoryLodgingQuoteRepository();
    calculator = new DynamicRateCalculator(baseRates, rules, calendar, () => NOW);
    service = new CreateLodgingQuoteService(calculator, quotes, () => QUOTE_ID);
  });

  it('calcula cada noche, guarda la cotización una sola vez y la devuelve (T023, FR-012)', async () => {
    const quote = await service.create(STAY);

    expect({ ...quote }).toEqual({
      quoteId: QUOTE_ID,
      roomId: ROOM_ID,
      checkInDate: '2026-12-23',
      checkOutDate: '2026-12-26',
      currency: 'COP',
      lodgingAmount: '1020000.00',
      nights: [
        {
          date: '2026-12-23',
          baseRate: '300000.00',
          seasonName: 'Regular',
          adjustmentPercent: '0.00',
          rate: '300000.00',
        },
        {
          date: '2026-12-24',
          baseRate: '300000.00',
          seasonName: 'Alta',
          adjustmentPercent: '20.00',
          rate: '360000.00',
        },
        {
          date: '2026-12-25',
          baseRate: '300000.00',
          seasonName: 'Alta',
          adjustmentPercent: '20.00',
          rate: '360000.00',
        },
      ],
    });
    expect([...quotes.quotes.values()]).toEqual([quote]);
  });

  it('cotiza lo mismo que devuelve la consulta de tarifa dinámica (contrato POST, regla 2)', async () => {
    const consulted = await new GetDynamicRateService(calculator).execute(STAY);

    const quote = await service.create(STAY);

    expect(quote.nights.map((n) => n.rate)).toEqual(
      consulted.nights.map((n) => n.dynamicRate.toString()),
    );
    expect(quote.lodgingAmount).toBe(consulted.total.toString());
  });

  it('guarda el roomId en minúsculas, como lo devuelve PostgreSQL', async () => {
    const quote = await service.create({ ...STAY, roomId: ROOM_ID.toUpperCase() });

    expect(quote.roomId).toBe(ROOM_ID);
    // A Módulo 1 se le pregunta con el id tal como llegó.
    expect(baseRates.calls[0].roomId).toBe(ROOM_ID.toUpperCase());
  });

  it('genera un quoteId nuevo en cada solicitud: no es idempotente', async () => {
    const ids = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'];
    service = new CreateLodgingQuoteService(calculator, quotes, () => ids.shift() as string);

    await service.create(STAY);
    await service.create(STAY);

    expect([...quotes.quotes.keys()]).toHaveLength(2);
  });

  describe('rechazos sin guardar nada (T024, FR-015)', () => {
    it.each([
      ['habitación no encontrada', new RoomNotFoundError()],
      ['tarifa base menor o igual a cero', new InvalidBaseRateError()],
      ['Módulo 1 no disponible', new Module1UnavailableError(new Error('timeout'))],
    ])('%s en una noche', async (_, failure) => {
      baseRates.failures.set('2026-12-25', failure);

      await expect(service.create(STAY)).rejects.toBe(failure);
      expect(quotes.quotes.size).toBe(0);
    });

    it('rango inválido, sin llamar a Módulo 1', async () => {
      await expect(
        service.create({ ...STAY, checkInDate: '2026-12-26', checkOutDate: '2026-12-26' }),
      ).rejects.toThrow(InvalidDateRangeError);
      expect(baseRates.calls).toHaveLength(0);
      expect(quotes.quotes.size).toBe(0);
    });

    it.each<[string, CreateLodgingQuoteCommand]>([
      ['sin roomId', { checkInDate: '2026-12-23', checkOutDate: '2026-12-26' }],
      ['sin checkOutDate', { roomId: ROOM_ID, checkInDate: '2026-12-23' }],
      [
        'fecha que no existe',
        { roomId: ROOM_ID, checkInDate: '2026-02-29', checkOutDate: '2026-03-02' },
      ],
    ])('%s → INVALID_QUERY_PARAMS', async (_, command) => {
      await expect(service.create(command)).rejects.toThrow(InvalidPricingRequestError);
      expect(baseRates.calls).toHaveLength(0);
      expect(quotes.quotes.size).toBe(0);
    });

    it('propaga el fallo al guardar', async () => {
      quotes.failure = new Error('base de datos caída');

      await expect(service.create(STAY)).rejects.toThrow('base de datos caída');
    });
  });
});
