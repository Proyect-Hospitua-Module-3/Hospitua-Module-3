import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { GenerateSettlementService } from '../../application/services/settlement/generate-settlement.service';
import { GetSettlementService } from '../../application/services/settlement/get-settlement.service';
import { GENERATE_SETTLEMENT_USE_CASE } from '../../domain/ports/in/settlement/generate-settlement.use-case';
import { GET_SETTLEMENT_USE_CASE } from '../../domain/ports/in/settlement/get-settlement.use-case';
import {
  LODGING_QUOTE_QUERY,
  LodgingQuoteQueryPort,
} from '../../domain/ports/out/pricing/lodging-quote-query.port';
import {
  RESERVATION_CLIENT,
  ReservationClientPort,
} from '../../domain/ports/out/settlement/reservation.client.port';
import {
  SETTLEMENT_INVOICE_QUERY,
  SettlementInvoiceQueryPort,
} from '../../domain/ports/out/settlement/settlement-invoice-query.port';
import {
  SETTLEMENT_QUERY,
  SettlementQueryPort,
} from '../../domain/ports/out/settlement/settlement-query.port';
import {
  SETTLEMENT_REPOSITORY,
  SettlementRepositoryPort,
} from '../../domain/ports/out/settlement/settlement.repository.port';
import { NoStoreMiddleware } from '../adapters/in/http/settlement/no-store.middleware';
import { SettlementsController } from '../adapters/in/http/settlement/settlements.controller';
import { Module2ReservationClient } from '../adapters/out/http/module2-reservation.client';
import { PrismaSettlementInvoiceQueryAdapter } from '../adapters/out/persistence/repositories/settlement/prisma-settlement-invoice-query.adapter';
import { PrismaSettlementQueryAdapter } from '../adapters/out/persistence/repositories/settlement/prisma-settlement-query.adapter';
import { PrismaSettlementRepository } from '../adapters/out/persistence/repositories/settlement/prisma-settlement.repository';
import { LoggedGenerateSettlementUseCase } from '../logging/settlement/logged-generate-settlement.use-case';
import { AuthModule } from './auth.module';
import { PricingModule } from './pricing.module';

// Bounded context `settlement`: binding puerto → adaptador por token (regla 4 del plan base).
// Los servicios de aplicación no tienen decoradores de NestJS: se construyen aquí.
// 007 no tiene endpoint propio (FR-001); el único controller es el de 002 (consulta).
@Module({
  // pricing exporta LODGING_QUOTE_QUERY: settlement lee las cotizaciones guardadas, nunca
  // invoca el cálculo de la tarifa dinámica (plan base, regla 5). auth: los guards JWT de
  // GET /api/settlements (002).
  imports: [AuthModule, HttpModule, PricingModule],
  controllers: [SettlementsController],
  providers: [
    // 007 — consulta de la reserva a Módulo 2
    Module2ReservationClient,
    { provide: RESERVATION_CLIENT, useExisting: Module2ReservationClient },

    // 007 — liquidación Final
    { provide: SETTLEMENT_REPOSITORY, useClass: PrismaSettlementRepository },
    {
      provide: GENERATE_SETTLEMENT_USE_CASE,
      inject: [RESERVATION_CLIENT, LODGING_QUOTE_QUERY, SETTLEMENT_REPOSITORY],
      useFactory: (
        reservations: ReservationClientPort,
        quotes: LodgingQuoteQueryPort,
        settlements: SettlementRepositoryPort,
      ) =>
        new LoggedGenerateSettlementUseCase(
          new GenerateSettlementService(reservations, quotes, settlements),
        ),
    },

    // 002 — consulta de liquidaciones (solo lectura)
    { provide: SETTLEMENT_QUERY, useClass: PrismaSettlementQueryAdapter },
    { provide: SETTLEMENT_INVOICE_QUERY, useClass: PrismaSettlementInvoiceQueryAdapter },
    {
      provide: GET_SETTLEMENT_USE_CASE,
      inject: [
        SETTLEMENT_QUERY,
        SETTLEMENT_INVOICE_QUERY,
        SETTLEMENT_REPOSITORY,
        RESERVATION_CLIENT,
        LODGING_QUOTE_QUERY,
      ],
      useFactory: (
        settlementQuery: SettlementQueryPort,
        invoices: SettlementInvoiceQueryPort,
        settlements: SettlementRepositoryPort,
        reservations: ReservationClientPort,
        quotes: LodgingQuoteQueryPort,
      ) => new GetSettlementService(settlementQuery, invoices, settlements, reservations, quotes),
    },
  ],
  // 010 (Registrar check-out) y 006 (Generar factura final) inyectan GENERATE_SETTLEMENT_USE_CASE.
  // RESERVATION_CLIENT queda disponible para la HU4 de 005 (acceso de la OTA).
  exports: [GENERATE_SETTLEMENT_USE_CASE, RESERVATION_CLIENT],
})
export class SettlementModule implements NestModule {
  // 002 — GET /api/settlements lleva información financiera: Cache-Control: no-store en
  // todas sus respuestas, también las de error (el middleware corre antes que los guards).
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(NoStoreMiddleware).forRoutes('api/settlements');
  }
}
