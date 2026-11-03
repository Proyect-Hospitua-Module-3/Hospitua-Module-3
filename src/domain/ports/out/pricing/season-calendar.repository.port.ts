// Feature 011 · Revisar temporada del año
import {
  PublicationContext,
  SeasonCalendarDraft,
  SeasonCalendarRevision,
} from '../../../model/pricing/season-calendar';

export const SEASON_CALENDAR_REPOSITORY = Symbol('SeasonCalendarRepositoryPort');

export interface EffectiveRevisions {
  // Instante usado: el pedido, o la hora de la base de datos si no se pidió ninguno.
  asOf: Date;
  // Para cada año pedido que tenga una, su revisión efectiva en `asOf`.
  revisions: SeasonCalendarRevision[];
}

// Persistencia de las revisiones anuales del calendario y sus entradas.
//
// `publish` serializa la publicación con los años vecinos, lee bajo bloqueo el estado
// que hace falta para decidir (revisión activa, temporadas referenciadas, BASE activos
// de los años vecinos) y se lo entrega a una función del dominio. Si la función lanza,
// la transacción se revierte completa y no queda nada publicado (FR-009, SC-006).
export interface SeasonCalendarRepositoryPort {
  // Revisión efectiva en `asOf` de cada año pedido: la de mayor número con
  // effective_at <= asOf. Una sola lectura consistente (revisiones y entradas juntas).
  // Espera a que terminen las publicaciones en curso de esos años, así dos lecturas con
  // el mismo `asOf` siempre devuelven lo mismo. `asOf` null significa "ahora" según la
  // base de datos.
  findEffectiveAt(years: number[], asOf: Date | null): Promise<EffectiveRevisions>;

  // Una revisión concreta, activa o histórica; null si no existe.
  findByNumber(year: number, revision: number): Promise<SeasonCalendarRevision | null>;

  // Publica el borrador como nueva revisión activa y devuelve lo guardado.
  publish(
    draft: SeasonCalendarDraft,
    actorId: string,
    decide: (context: PublicationContext) => void,
  ): Promise<SeasonCalendarRevision>;
}
