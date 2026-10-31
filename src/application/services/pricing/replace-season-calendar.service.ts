// Feature 011 · Revisar temporada del año
import { randomUUID } from 'crypto';
import { SeasonCalendarDraft } from '../../../domain/model/pricing/season-calendar';
import {
  ReplaceSeasonCalendarCommand,
  ReplaceSeasonCalendarUseCase,
} from '../../../domain/ports/in/pricing/replace-season-calendar.use-case';
import {
  ReviewSeasonCalendarUseCase,
  SeasonCalendarView,
} from '../../../domain/ports/in/pricing/review-season-calendar.use-case';
import { SeasonCalendarRepositoryPort } from '../../../domain/ports/out/pricing/season-calendar.repository.port';

// Sin decoradores de NestJS: la capa de aplicación solo depende del dominio.
// El wiring con sus adaptadores está en infrastructure/config/pricing.module.ts.
export class ReplaceSeasonCalendarService implements ReplaceSeasonCalendarUseCase {
  constructor(
    private readonly calendars: SeasonCalendarRepositoryPort,
    private readonly reviewer: ReviewSeasonCalendarUseCase,
    // Id para las entradas nuevas que llegan sin entryId.
    private readonly newEntryId: () => string = randomUUID,
  ) {}

  async replace(command: ReplaceSeasonCalendarCommand): Promise<SeasonCalendarView> {
    // Forma y fechas se validan antes de escribir: nada queda a medias (FR-009, SC-006).
    const draft = SeasonCalendarDraft.parse(
      { year: command.year, expectedRevision: command.expectedRevision, entries: command.entries },
      this.newEntryId,
    );

    // Sin responsable no hay trazabilidad, y sin trazabilidad no hay cambio (NFR-004).
    if (!command.actorId?.trim()) {
      throw new Error('No se puede publicar el calendario sin identificar al responsable.');
    }

    // El dominio decide con el estado leído bajo bloqueo; si lanza, nada se publica.
    const published = await this.calendars.publish(draft, command.actorId, (context) =>
      draft.assertPublishable(context),
    );

    // Respuesta: el calendario efectivo con la revisión recién publicada, con la del año
    // anterior y el catálogo tomados en su effectiveAt (contrato, "PUT 200 OK").
    return this.reviewer.review({ year: published.year, revision: published.revision });
  }
}
