import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { GenerateSettlementService } from '../../application/services/settlement/generate-settlement.service';
import { GENERATE_SETTLEMENT_USE_CASE } from '../../domain/ports/in/settlement/generate-settlement.use-case';
import {
  LODGING_QUOTE_QUERY,
  LodgingQuoteQueryPort,
} from '../../domain/ports/out/pricing/lodging-quote-query.port';
import {
  RESERVATION_CLIENT,
  ReservationClientPort,
} from '../../domain/ports/out/settlement/reservation.client.port';
import {
  SETTLEMENT_REPOSITORY,
  SettlementRepositoryPort,
} from '../../domain/ports/out/settlement/settlement.repository.port';
import { Module2ReservationClient } from '../adapters/out/http/module2-reservation.client';
import { PrismaSettlementRepository } from '../adapters/out/persistence/repositories/settlement/prisma-settlement.repository';
import { LoggedGenerateSettlementUseCase } from '../logging/settlement/logged-generate-settlement.use-case';
import { PricingModule } from './pricing.module';

// Bounded context `settlement`: binding puerto → adaptador por token (regla 4 del plan base).
// Los servicios de aplicación no tienen decoradores de NestJS: se construyen aquí.
// Sin controllers: 007 no tiene endpoint propio (FR-001).
@Module({
  // pricing exporta LODGING_QUOTE_QUERY: settlement lee las cotizaciones guardadas, nunca
  // invoca el cálculo de la tarifa dinámica (plan base, regla 5).
  imports: [HttpModule, PricingModule],
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
  ],
  // 010 (Registrar check-out) y 006 (Generar factura final) inyectan GENERATE_SETTLEMENT_USE_CASE.
  // RESERVATION_CLIENT queda disponible para la HU4 de 005 (acceso de la OTA).
  exports: [GENERATE_SETTLEMENT_USE_CASE, RESERVATION_CLIENT],
})
export class SettlementModule {}
