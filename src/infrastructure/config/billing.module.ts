import { Module } from '@nestjs/common';
import { GetCurrentVatRateService } from '../../application/services/billing/get-current-vat-rate.service';
import { UpdateVatRateService } from '../../application/services/billing/update-vat-rate.service';
import { GET_CURRENT_VAT_RATE_USE_CASE } from '../../domain/ports/in/billing/get-current-vat-rate.use-case';
import { UPDATE_VAT_RATE_USE_CASE } from '../../domain/ports/in/billing/update-vat-rate.use-case';
import {
  VAT_RATE_REPOSITORY,
  VatRateRepositoryPort,
} from '../../domain/ports/out/billing/vat-rate.repository.port';
import { VatRateAdminController } from '../adapters/in/http/billing/vat-rate-admin.controller';
import { PrismaVatRateRepository } from '../adapters/out/persistence/repositories/billing/prisma-vat-rate.repository';
import { AuthModule } from './auth.module';

// Bounded context `billing`: binding puerto → adaptador por token (regla 4 del plan base).
// Los servicios de aplicación no tienen decoradores de NestJS: se construyen aquí.
@Module({
  imports: [AuthModule],
  controllers: [VatRateAdminController],
  providers: [
    { provide: VAT_RATE_REPOSITORY, useClass: PrismaVatRateRepository },
    {
      provide: UPDATE_VAT_RATE_USE_CASE,
      inject: [VAT_RATE_REPOSITORY],
      useFactory: (vatRates: VatRateRepositoryPort) => new UpdateVatRateService(vatRates),
    },
    {
      provide: GET_CURRENT_VAT_RATE_USE_CASE,
      inject: [VAT_RATE_REPOSITORY],
      useFactory: (vatRates: VatRateRepositoryPort) => new GetCurrentVatRateService(vatRates),
    },
  ],
  // 006 Generar factura final leerá el IVA por aquí, nunca por el repositorio.
  exports: [GET_CURRENT_VAT_RATE_USE_CASE],
})
export class BillingModule {}
