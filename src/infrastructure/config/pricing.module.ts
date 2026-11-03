import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { GetBaseRateService } from '../../application/services/pricing/get-base-rate.service';
import { GetEffectiveSeasonRulesService } from '../../application/services/pricing/get-effective-season-rules.service';
import { ModifySeasonRuleService } from '../../application/services/pricing/modify-season-rule.service';
import { GET_BASE_RATE_USE_CASE } from '../../domain/ports/in/pricing/get-base-rate.use-case';
import { GET_EFFECTIVE_SEASON_RULES_USE_CASE } from '../../domain/ports/in/pricing/get-effective-season-rules.use-case';
import { MODIFY_SEASON_RULE_USE_CASE } from '../../domain/ports/in/pricing/modify-season-rule.use-case';
import {
  BASE_RATE_CLIENT,
  BaseRateClientPort,
} from '../../domain/ports/out/pricing/base-rate.client.port';
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
import { Module1BaseRateClient } from '../adapters/out/http/module1-base-rate.client';
import { PrismaSeasonRuleRepository } from '../adapters/out/persistence/repositories/pricing/prisma-season-rule.repository';
import { AuthModule } from './auth.module';

// Bounded context `pricing`: binding puerto → adaptador por token (regla 4 del plan base).
// Los servicios de aplicación no tienen decoradores de NestJS: se construyen aquí.
@Module({
  imports: [AuthModule, HttpModule],
  controllers: [SeasonAdminController],
  providers: [
    { provide: SEASON_RULE_REPOSITORY, useClass: PrismaSeasonRuleRepository },
    Module1BaseRateClient,
    { provide: BASE_RATE_CLIENT, useExisting: Module1BaseRateClient },
    // Provisional hasta la feature 011: ver PendingSeasonCalendarReferenceAdapter.
    { provide: SEASON_CALENDAR_REFERENCE, useClass: PendingSeasonCalendarReferenceAdapter },
    {
      provide: GET_BASE_RATE_USE_CASE,
      inject: [BASE_RATE_CLIENT],
      useFactory: (client: BaseRateClientPort) => new GetBaseRateService(client),
    },
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
  exports: [GET_EFFECTIVE_SEASON_RULES_USE_CASE, GET_BASE_RATE_USE_CASE],
})
export class PricingModule {}
