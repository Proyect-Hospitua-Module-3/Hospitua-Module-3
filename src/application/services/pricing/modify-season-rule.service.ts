// Feature 009 · Modificar precio tarifa según temporada
import { InvalidSeasonError } from '../../../domain/errors/pricing/invalid-season.error';
import { SeasonInUseError } from '../../../domain/errors/pricing/season-in-use.error';
import { SeasonNotFoundError } from '../../../domain/errors/pricing/season-not-found.error';
import { Season, SeasonChangeRequest } from '../../../domain/model/pricing/season';
import { SeasonAdjustmentPercent } from '../../../domain/model/pricing/season-adjustment-percent.vo';
import { SeasonColor } from '../../../domain/model/pricing/season-color.vo';
import { SeasonName } from '../../../domain/model/pricing/season-name.vo';
import {
  CreateSeasonCommand,
  ModifySeasonRuleUseCase,
  RetireSeasonCommand,
  SeasonCatalog,
  UpdateSeasonCommand,
} from '../../../domain/ports/in/pricing/modify-season-rule.use-case';
import { SeasonCalendarReferencePort } from '../../../domain/ports/out/pricing/season-calendar-reference.port';
import { SeasonRuleRepositoryPort } from '../../../domain/ports/out/pricing/season-rule.repository.port';

const UUID_FORMAT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Sin decoradores de NestJS: la capa de aplicación solo depende del dominio.
// El wiring con sus adaptadores está en infrastructure/config/pricing.module.ts.
export class ModifySeasonRuleService implements ModifySeasonRuleUseCase {
  constructor(
    private readonly seasons: SeasonRuleRepositoryPort,
    private readonly calendar: SeasonCalendarReferencePort,
  ) {}

  list(): Promise<SeasonCatalog> {
    return this.seasons.listActive();
  }

  async create(command: CreateSeasonCommand): Promise<Season> {
    // Todo se valida antes de escribir: un valor inválido no deja nada a medias (SC-002).
    const season = {
      name: SeasonName.of(command.name),
      color: SeasonColor.of(command.color),
      adjustmentPercent: SeasonAdjustmentPercent.of(command.adjustmentPercent),
    };
    return this.seasons.create(season, this.requireActor(command.actorId));
  }

  async update(command: UpdateSeasonCommand): Promise<Season> {
    const request = this.parseChangeRequest(command);
    const actorId = this.requireActor(command.actorId);
    this.requireSeasonId(command.seasonId);

    return this.seasons.modify(command.seasonId, actorId, (current) =>
      current.planChange(request, command.expectedVersion),
    );
  }

  async retire(command: RetireSeasonCommand): Promise<void> {
    const actorId = this.requireActor(command.actorId);
    this.requireSeasonId(command.seasonId);

    // Se consulta el calendario con la temporada ya bloqueada: así una publicación
    // concurrente de 011 que la asigne no puede colarse entre la consulta y el retiro.
    await this.seasons.retire(command.seasonId, actorId, async (current) => {
      current.assertCanBeRetired();
      if (await this.calendar.isReferencedByActiveRevision(current.id)) {
        throw new SeasonInUseError();
      }
    });
  }

  private parseChangeRequest(command: UpdateSeasonCommand): SeasonChangeRequest {
    const { name, color, adjustmentPercent } = command;
    if (name === undefined && color === undefined && adjustmentPercent === undefined) {
      throw new InvalidSeasonError(
        'Indica al menos un campo para cambiar: name, color o adjustmentPercent.',
      );
    }
    return {
      name: name === undefined ? undefined : SeasonName.of(name),
      color: color === undefined ? undefined : SeasonColor.of(color),
      adjustmentPercent:
        adjustmentPercent === undefined ? undefined : SeasonAdjustmentPercent.of(adjustmentPercent),
    };
  }

  // Un id mal formado no puede existir: se responde igual que a uno inexistente.
  private requireSeasonId(seasonId: string): void {
    if (!UUID_FORMAT.test(seasonId)) {
      throw new SeasonNotFoundError(seasonId);
    }
  }

  // Sin responsable no hay trazabilidad, y sin trazabilidad no hay cambio (FR-004).
  private requireActor(actorId: string): string {
    if (!actorId?.trim()) {
      throw new Error('No se puede cambiar el catálogo sin identificar al responsable del cambio.');
    }
    return actorId;
  }
}
