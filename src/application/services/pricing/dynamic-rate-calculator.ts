// Feature 005 · Consultar tarifa dinámica
// Cálculo por noche que comparten GET /pricing/dynamic-rate y POST /pricing/quotes, para
// que el valor cotizado sea el mismo que Módulo 2 pudo consultar antes (contrato POST, regla 2).
import { SeasonConfigurationInconsistentError } from '../../../domain/errors/pricing/season-configuration-inconsistent.error';
import { CalendarDate } from '../../../domain/model/pricing/calendar-date.vo';
import { DynamicRate } from '../../../domain/model/pricing/dynamic-rate';
import { SeasonAdjustmentPercent } from '../../../domain/model/pricing/season-adjustment-percent.vo';
import { StayRange } from '../../../domain/model/pricing/stay-range';
import { GetBaseRateUseCase } from '../../../domain/ports/in/pricing/get-base-rate.use-case';
import {
  EffectiveSeasonRule,
  GetEffectiveSeasonRulesUseCase,
} from '../../../domain/ports/in/pricing/get-effective-season-rules.use-case';
import { ResolveSeasonByDateUseCase } from '../../../domain/ports/in/pricing/resolve-season-by-date.use-case';

// Noches que se calculan a la vez (T019). En paralelo para que una estancia larga no
// sume la latencia de Módulo 1 noche tras noche, pero con límite para no saturarlo; si
// Módulo 1 cae, el circuit breaker de 004 corta las llamadas. Revisar con datos reales
// de latencia (T045).
export const NIGHTS_IN_PARALLEL = 4;

export class DynamicRateCalculator {
  constructor(
    private readonly baseRates: GetBaseRateUseCase,
    private readonly seasonRules: GetEffectiveSeasonRulesUseCase,
    private readonly seasonCalendar: ResolveSeasonByDateUseCase,
    private readonly now: () => Date = () => new Date(),
  ) {}

  // Todo o nada: si cualquier noche falla, falla todo y no se devuelve ninguna (FR-006).
  async calculate(roomId: string, stay: StayRange): Promise<DynamicRate[]> {
    // Un solo instante y un solo snapshot de reglas para toda la consulta: un cambio de
    // temporada a mitad de camino no se mezcla entre noches (contrato GET, regla 3).
    const asOf = this.now();
    const rules = await this.seasonRules.getAll(asOf);
    const seasonsById = new Map(rules.seasons.map((season) => [season.seasonId, season]));

    return mapWithLimit(stay.nights(), NIGHTS_IN_PARALLEL, (date) =>
      this.calculateNight(roomId, date, asOf, seasonsById),
    );
  }

  private async calculateNight(
    roomId: string,
    date: CalendarDate,
    asOf: Date,
    seasonsById: ReadonlyMap<string, EffectiveSeasonRule>,
  ): Promise<DynamicRate> {
    const night = date.toString();
    const [baseRate, classification] = await Promise.all([
      this.baseRates.execute(roomId, night),
      this.seasonCalendar.resolve({ date: night, asOf }),
    ]);

    // Sin clasificación explícita, 011 ya devuelve la temporada por defecto, y se usa su
    // ajuste vigente en 009 sin suponer que es cero (FR-004).
    const season = seasonsById.get(classification.seasonId);
    if (!season) {
      throw new SeasonConfigurationInconsistentError(night, classification.seasonId);
    }

    return DynamicRate.compute({
      date,
      baseRate,
      seasonName: season.name,
      adjustmentPercent: SeasonAdjustmentPercent.of(season.adjustmentPercent),
    });
  }
}

// Como Promise.all, pero con a lo sumo `limit` tareas en curso y el resultado en el mismo
// orden que `items`. Tras el primer fallo no empieza tareas nuevas y rechaza con ese error.
async function mapWithLimit<T, R>(
  items: readonly T[],
  limit: number,
  task: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  let failed = false;

  const worker = async (): Promise<void> => {
    while (!failed && nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      try {
        results[index] = await task(items[index]);
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}
