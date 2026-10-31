// Feature 011 · Revisar temporada del año
import { OverlappingSeasonCalendarError } from '../../../src/domain/errors/pricing/overlapping-season-calendar.error';
import {
  NeighborBase,
  PublicationContext,
  SeasonCalendarDraft,
  SeasonCalendarRevision,
} from '../../../src/domain/model/pricing/season-calendar';
import { SeasonCalendarReferencePort } from '../../../src/domain/ports/out/pricing/season-calendar-reference.port';
import {
  EffectiveRevisions,
  SeasonCalendarRepositoryPort,
} from '../../../src/domain/ports/out/pricing/season-calendar.repository.port';

interface StoredRevision {
  revision: SeasonCalendarRevision;
  active: boolean;
}

// Doble de prueba del puerto: mismo comportamiento observable que el repositorio de
// PostgreSQL (revisión efectiva por asOf, una activa por año, publicación atómica con la
// decisión del dominio, defensa final contra solapes BASE entre años y consulta de uso
// para 009). Permite probar casos de uso y endpoints sin base de datos.
export class InMemorySeasonCalendarRepository
  implements SeasonCalendarRepositoryPort, SeasonCalendarReferencePort
{
  readonly stored: StoredRevision[] = [];
  failWith: Error | null = null;

  constructor(
    // Reloj de la "base de datos": hora de publicación y "ahora" de las lecturas.
    private readonly clock: () => Date,
    // De los ids pedidos, los que existen en el catálogo y no están retirados.
    private readonly activeSeasonIds: (ids: string[]) => Set<string> | Promise<Set<string>>,
  ) {}

  async findEffectiveAt(years: number[], asOf: Date | null): Promise<EffectiveRevisions> {
    this.failIfAsked();
    const reference = asOf ?? this.clock();
    const revisions = years
      .map(
        (year) =>
          this.stored
            .map((s) => s.revision)
            .filter((r) => r.year === year && r.effectiveAt.getTime() <= reference.getTime())
            .sort((a, b) => b.revision - a.revision)[0],
      )
      .filter((r): r is SeasonCalendarRevision => r !== undefined);
    return { asOf: reference, revisions };
  }

  async findByNumber(year: number, revision: number): Promise<SeasonCalendarRevision | null> {
    this.failIfAsked();
    return (
      this.stored.find((s) => s.revision.year === year && s.revision.revision === revision)
        ?.revision ?? null
    );
  }

  async publish(
    draft: SeasonCalendarDraft,
    actorId: string,
    decide: (context: PublicationContext) => void,
  ): Promise<SeasonCalendarRevision> {
    this.failIfAsked();
    const year = draft.year.value;
    const neighborBases: NeighborBase[] = [year - 1, year + 1].flatMap((neighborYear) => {
      const active = this.active(neighborYear);
      return active
        ? active.entries
            .filter((e) => e.isBase)
            .map((entry) => ({ entry, ownerYear: active.year, ownerRevision: active.revision }))
        : [];
    });
    decide({
      activeRevision: this.active(year)?.revision ?? 0,
      activeSeasonIds: await this.activeSeasonIds(draft.referencedSeasonIds()),
      neighborBases,
    });

    // Igual que la restricción de exclusión de season_calendar_active_base.
    const otherActiveBases = this.stored
      .filter((s) => s.active && s.revision.year !== year)
      .flatMap((s) => s.revision.entries.filter((e) => e.isBase));
    for (const base of draft.entries.filter((e) => e.isBase)) {
      if (otherActiveBases.some((other) => other.range.intersection(base.range))) {
        throw new OverlappingSeasonCalendarError(
          'solape detectado por la restricción de exclusión.',
        );
      }
    }

    const now = this.clock();
    const number =
      Math.max(
        0,
        ...this.stored.filter((s) => s.revision.year === year).map((s) => s.revision.revision),
      ) + 1;
    const revision = new SeasonCalendarRevision(year, number, now, actorId, now, [
      ...draft.entries,
    ]);
    for (const s of this.stored.filter((s) => s.revision.year === year)) {
      s.active = false;
    }
    this.stored.push({ revision, active: true });
    return revision;
  }

  async isReferencedByActiveRevision(seasonId: string): Promise<boolean> {
    this.failIfAsked();
    return this.stored.some(
      (s) => s.active && s.revision.entries.some((e) => e.seasonId === seasonId),
    );
  }

  active(year: number): SeasonCalendarRevision | null {
    return this.stored.find((s) => s.active && s.revision.year === year)?.revision ?? null;
  }

  private failIfAsked(): void {
    if (this.failWith) {
      throw this.failWith;
    }
  }
}

// Reloj simulado que avanza un segundo en cada lectura, para probar el corte por asOf.
export function steppingClock(start = Date.UTC(2026, 9, 1)): () => Date {
  let now = start;
  return () => {
    now += 1000;
    return new Date(now);
  };
}
