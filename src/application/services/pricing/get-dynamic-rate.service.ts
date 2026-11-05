// Feature 005 · Consultar tarifa dinámica
import { InvalidPricingRequestError } from '../../../domain/errors/pricing/invalid-pricing-request.error';
import { StayRange } from '../../../domain/model/pricing/stay-range';
import { Money } from '../../../domain/model/shared/money.vo';
import {
  DynamicRateQuery,
  DynamicRateResult,
  GetDynamicRateUseCase,
} from '../../../domain/ports/in/pricing/get-dynamic-rate.use-case';
import { DynamicRateCalculator } from './dynamic-rate-calculator';
import { parseDate, parseRoomId, parseStay } from './pricing-request';

// Tarifa base (004) + reglas de temporada (009) + calendario (011), noche por noche.
// Solo lectura: no guarda nada (FR-007). El acceso de la OTA (HU4) llega con 007.
export class GetDynamicRateService implements GetDynamicRateUseCase {
  constructor(private readonly calculator: DynamicRateCalculator) {}

  async execute(query: DynamicRateQuery): Promise<DynamicRateResult> {
    // Parámetros y rango primero, sin llamar a ningún puerto (contrato GET, regla 1).
    const roomId = parseRoomId(query.roomId);
    const stay = this.stayOf(query);

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
}
