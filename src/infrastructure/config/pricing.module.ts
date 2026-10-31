import { Module } from '@nestjs/common';
import { GetEffectiveSeasonRulesService } from '../../application/services/pricing/get-effective-season-rules.service';
import { ModifySeasonRuleService } from '../../application/services/pricing/modify-season-rule.service';
import { GET_EFFECTIVE_SEASON_RULES_USE_CASE } from '../../domain/ports/in/pricing/get-effective-season-rules.use-case';
import { MODIFY_SEASON_RULE_USE_CASE } from '../../domain/ports/in/pricing/modify-season-rule.use-case';
import {
  SEASON_CALENDAR_REFERENCE,
  SeasonCalendarReferencePort,
} from '../../domain/ports/out/pricing/season-calendar-reference.port';
import {
  SEASON_RULE_REPOSITORY,
  SeasonRuleRepositoryPort,
} from '../../domain/ports/out/pricing/season-rule.repository.port';
import { SeasonAdminController } from '../adapters/in/http/pricing/season-admin.controller';
import { PendingSeasonCalendarReferenceAdapter } from '../adapters/out/calendar/pending-season-calendar-reference.adapter';
import { PrismaSeasonRuleRepository } from '../adapters/out/persistence/repositories/pricing/prisma-season-rule.repository';
import { AuthModule } from './auth.module';

// Bounded context `pricing`: binding puerto → adaptador por token (regla 4 del plan base).
// Los servicios de aplicación no tienen decoradores de NestJS: se construyen aquí.
@Module({
  imports: [AuthModule],
  controllers: [SeasonAdminController],
  providers: [
    { provide: SEASON_RULE_REPOSITORY, useClass: PrismaSeasonRuleRepository },
    // Provisional hasta la feature 011: ver PendingSeasonCalendarReferenceAdapter.
    { provide: SEASON_CALENDAR_REFERENCE, useClass: PendingSeasonCalendarReferenceAdapter },
    {
      provide: MODIFY_SEASON_RULE_USE_CASE,
      inject: [SEASON_RULE_REPOSITORY, SEASON_CALENDAR_REFERENCE],
      useFactory: (seasons: SeasonRuleRepositoryPort, calendar: SeasonCalendarReferencePort) =>
        new ModifySeasonRuleService(seasons, calendar),
    },
    {
      provide: GET_EFFECTIVE_SEASON_RULES_USE_CASE,
      inject: [SEASON_RULE_REPOSITORY],
      useFactory: (seasons: SeasonRuleRepositoryPort) => new GetEffectiveSeasonRulesService(seasons),
    },
  ],
  // 005 (tarifa dinámica) y 011 (calendario) leerán las reglas por aquí.
  exports: [GET_EFFECTIVE_SEASON_RULES_USE_CASE],
})
export class PricingModule {}
