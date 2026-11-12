// Feature 003 · Consultar porcentaje de comisión OTA
import { Module } from '@nestjs/common';
import { GetLatestOtaCommissionService } from '../../application/services/ota-commission/get-latest-ota-commission.service';
import { GET_LATEST_OTA_COMMISSION_USE_CASE } from '../../domain/ports/in/ota-commission/get-latest-ota-commission.use-case';
import {
  OTA_COMMISSION_QUERY,
  OtaCommissionQueryPort,
} from '../../domain/ports/out/ota-commission/ota-commission-query.port';
import { OtaCommissionController } from '../adapters/in/http/ota-commission/ota-commission.controller';
import { PrismaOtaCommissionQueryAdapter } from '../adapters/out/persistence/repositories/ota-commission/prisma-ota-commission-query.adapter';
import { AuthModule } from './auth.module';

// Bounded context `ota-commission` (T001): binding puerto → adaptador por token (regla 4 del
// plan base). Lee settlement con su propio puerto; no importa SettlementModule ni exporta
// nada, así que ningún caso de uso de settlement puede depender de esta consulta (BR-004).
@Module({
  // auth: los guards JWT de GET /ota-commission/{otaId}.
  imports: [AuthModule],
  controllers: [OtaCommissionController],
  providers: [
    { provide: OTA_COMMISSION_QUERY, useClass: PrismaOtaCommissionQueryAdapter },
    {
      provide: GET_LATEST_OTA_COMMISSION_USE_CASE,
      inject: [OTA_COMMISSION_QUERY],
      useFactory: (query: OtaCommissionQueryPort) => new GetLatestOtaCommissionService(query),
    },
  ],
})
export class OtaCommissionModule {}
