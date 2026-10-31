// Feature 009 · Modificar precio tarifa según temporada
import { Injectable } from '@nestjs/common';
import { SeasonCalendarReferencePort } from '../../../../domain/ports/out/pricing/season-calendar-reference.port';

// PROVISIONAL hasta que exista la feature 011 (calendario anual).
// Sin calendario, ninguna revisión activa puede asignar una temporada, así que la
// respuesta correcta hoy es "no está en uso". Cuando se implemente 011, este adaptador
// se reemplaza en pricing.module.ts por uno que consulte season_calendar_entry.
@Injectable()
export class PendingSeasonCalendarReferenceAdapter implements SeasonCalendarReferencePort {
  async isReferencedByActiveRevision(_seasonId: string): Promise<boolean> {
    return false;
  }
}
