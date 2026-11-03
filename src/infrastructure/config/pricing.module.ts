import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { GetBaseRateService } from '../../application/services/pricing/get-base-rate.service';
import { GetEffectiveSeasonRulesService } from '../../application/services/pricing/get-effective-season-rules.service';
import { ModifySeasonRuleService } from '../../application/services/pricing/modify-season-rule.service';
import { ReplaceSeasonCalendarService } from '../../application/services/pricing/replace-season-calendar.service';
import { ResolveSeasonByDateService } from '../../application/services/pricing/resolve-season-by-date.service';
import { ReviewSeasonCalendarService } from '../../application/services/pricing/review-season-calendar.service';
import { GET_BASE_RATE_USE_CASE } from '../../domain/ports/in/pricing/get-base-rate.use-case';
import { GET_EFFECTIVE_SEASON_RULES_USE_CASE } from '../../domain/ports/in/pricing/get-effective-season-rules.use-case';
import { MODIFY_SEASON_RULE_USE_CASE } from '../../domain/ports/in/pricing/modify-season-rule.use-case';
import { REPLACE_SEASON_CALENDAR_USE_CASE } from '../../domain/ports/in/pricing/replace-season-calendar.use-case';
import { RESOLVE_SEASON_BY_DATE_USE_CASE } from '../../domain/ports/in/pricing/resolve-season-by-date.use-case';
import {
  REVIEW_SEASON_CALENDAR_USE_CASE,
  ReviewSeasonCalendarUseCase,
} from '../../domain/ports/in/pricing/review-season-calendar.use-case';
import {
  BASE_RATE_CLIENT,
  BaseRateClientPort,
} from '../../domain/ports/out/pricing/base-rate.client.port';
import {
  SEASON_CALENDAR_REFERENCE,
  SeasonCalendarReferencePort,
} from '../../domain/ports/out/pricing/season-calendar-reference.port';
import {
  SEASON_CALENDAR_REPOSITORY,
  SeasonCalendarRepositoryPort,
} from '../../domain/ports/out/pricing/season-calendar.repository.port';
import {
  SEASON_CATALOG_QUERY,
  SeasonCatalogQueryPort,
} from '../../domain/ports/out/pricing/season-catalog-query.port';
import {
  SEASON_RULE_REPOSITORY,
  SeasonRuleRepositoryPort,
} from '../../domain/ports/out/pricing/season-rule.repository.port';
import { SeasonAdminController } from '../adapters/in/http/pricing/season-admin.controller';
import { Module1BaseRateClient } from '../adapters/out/http/module1-base-rate.client';
import { SeasonRulesCatalogAdapter } from '../adapters/out/catalog/season-rules-catalog.adapter';
import { PrismaSeasonCalendarRepository } from '../adapters/out/persistence/repositories/pricing/prisma-season-calendar.repository';
import { PrismaSeasonRuleRepository } from '../adapters/out/persistence/repositories/pricing/prisma-season-rule.repository';
import { AuthModule } from './auth.module';

// Bounded context `pricing`: binding puerto → adaptador por token (regla 4 del plan base).
// Los servicios de aplicación no tienen decoradores de NestJS: se construyen aquí.
@Module({
  imports: [AuthModule, HttpModule],
  controllers: [SeasonAdminController],
  providers: [
    // 004 — consulta de tarifa base a Módulo 1
    Module1BaseRateClient,
    { provide: BASE_RATE_CLIENT, useExisting: Module1BaseRateClient },
    {
      provide: GET_BASE_RATE_USE_CASE,
      inject: [BASE_RATE_CLIENT],
      useFactory: (client: BaseRateClientPort) => new GetBaseRateService(client),
    },

    // 009 — catálogo de temporadas y su ajuste
    { provide: SEASON_RULE_REPOSITORY, useClass: PrismaSeasonRuleRepository },
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

    // 011 — calendario anual de temporadas
    { provide: SEASON_CALENDAR_REPOSITORY, useClass: PrismaSeasonCalendarRepository },
    // 009 consulta al calendario si una temporada está en uso antes de retirarla.
    { provide: SEASON_CALENDAR_REFERENCE, useExisting: SEASON_CALENDAR_REPOSITORY },
    { provide: SEASON_CATALOG_QUERY, useClass: SeasonRulesCatalogAdapter },
    {
      provide: REVIEW_SEASON_CALENDAR_USE_CASE,
      inject: [SEASON_CALENDAR_REPOSITORY, SEASON_CATALOG_QUERY],
      useFactory: (calendars: SeasonCalendarRepositoryPort, catalog: SeasonCatalogQueryPort) =>
        new ReviewSeasonCalendarService(calendars, catalog),
    },
    {
      provide: REPLACE_SEASON_CALENDAR_USE_CASE,
      inject: [SEASON_CALENDAR_REPOSITORY, REVIEW_SEASON_CALENDAR_USE_CASE],
      useFactory: (calendars: SeasonCalendarRepositoryPort, reviewer: ReviewSeasonCalendarUseCase) =>
        new ReplaceSeasonCalendarService(calendars, reviewer),
    },
    {
      provide: RESOLVE_SEASON_BY_DATE_USE_CASE,
      inject: [SEASON_CALENDAR_REPOSITORY, SEASON_CATALOG_QUERY],
      useFactory: (calendars: SeasonCalendarRepositoryPort, catalog: SeasonCatalogQueryPort) =>
        new ResolveSeasonByDateService(calendars, catalog),
    },
  ],
  // 005 (tarifa dinámica) lee la tarifa base (004), las reglas de 009 y resuelve la temporada de cada fecha con 011.
  exports: [
    GET_BASE_RATE_USE_CASE,
    GET_EFFECTIVE_SEASON_RULES_USE_CASE,
    RESOLVE_SEASON_BY_DATE_USE_CASE,
  ],
})
export class PricingModule {}
