// Feature 005 · Consultar tarifa dinámica
// Forma pública: contrato PORT-find-lodging-quotes-by-ids.md (la consume 007).
import { Money } from '../shared/money.vo';
import { DynamicRate } from './dynamic-rate';
import { StayRange } from './stay-range';

// Importes y porcentajes como texto decimal exacto; nunca como number.
export interface LodgingQuoteNight {
  readonly date: string;
  readonly baseRate: string;
  readonly seasonName: string;
  readonly adjustmentPercent: string;
  readonly rate: string;
}

export interface NewLodgingQuote {
  quoteId: string;
  roomId: string;
  stay: StayRange;
  nights: readonly DynamicRate[];
}

export interface StoredLodgingQuote {
  quoteId: string;
  roomId: string;
  checkInDate: string;
  checkOutDate: string;
  currency: string;
  lodgingAmount: string;
  nights: readonly LodgingQuoteNight[];
}

const QUOTE_CURRENCY = 'COP';

// Cotización del hospedaje de una habitación. Inmutable: una vez creada nadie la cambia
// ni la recalcula (BR-006, FR-013); 007 toma de aquí el valor de hospedaje.
export class LodgingQuote {
  private constructor(
    readonly quoteId: string,
    readonly roomId: string,
    readonly checkInDate: string,
    readonly checkOutDate: string,
    readonly currency: string,
    readonly lodgingAmount: string,
    readonly nights: readonly LodgingQuoteNight[],
  ) {
    Object.freeze(this);
  }

  // Una noche por cada fecha de la estadía, en orden; el total es la suma exacta de las
  // tarifas de cada noche (FR-012).
  static create(input: NewLodgingQuote): LodgingQuote {
    const expectedNights = input.stay.nights();
    const matchesStay =
      input.nights.length === expectedNights.length &&
      input.nights.every((night, index) => night.date.equals(expectedNights[index]));
    if (!matchesStay) {
      // Error de programación, no de negocio: sale como 422 UNEXPECTED_ERROR.
      throw new Error('Las noches de la cotización no coinciden con las fechas de la estadía.');
    }

    const lodgingAmount = input.nights.reduce(
      (total, night) => total.add(night.dynamicRate),
      Money.zero(),
    );
    const nights = input.nights.map((night) =>
      Object.freeze({
        date: night.date.toString(),
        baseRate: night.baseRate.toString(),
        seasonName: night.seasonName,
        adjustmentPercent: night.adjustmentPercent.toString(),
        rate: night.dynamicRate.toString(),
      }),
    );

    return new LodgingQuote(
      input.quoteId,
      input.roomId,
      input.stay.checkInDate.toString(),
      input.stay.checkOutDate.toString(),
      QUOTE_CURRENCY,
      lodgingAmount.toString(),
      Object.freeze(nights),
    );
  }

  // Reconstruye una cotización guardada tal como está, sin recalcular nada (FR-013).
  static restore(stored: StoredLodgingQuote): LodgingQuote {
    return new LodgingQuote(
      stored.quoteId,
      stored.roomId,
      stored.checkInDate,
      stored.checkOutDate,
      stored.currency,
      stored.lodgingAmount,
      Object.freeze(stored.nights.map((night) => Object.freeze({ ...night }))),
    );
  }
}
