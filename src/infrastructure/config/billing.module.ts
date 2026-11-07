import { Module } from '@nestjs/common';
import { GenerateFinalInvoiceService } from '../../application/services/billing/generate-final-invoice.service';
import { GetCurrentVatRateService } from '../../application/services/billing/get-current-vat-rate.service';
import { UpdateVatRateService } from '../../application/services/billing/update-vat-rate.service';
import { GENERATE_FINAL_INVOICE_USE_CASE } from '../../domain/ports/in/billing/generate-final-invoice.use-case';
import {
  GET_CURRENT_VAT_RATE_USE_CASE,
  GetCurrentVatRateUseCase,
} from '../../domain/ports/in/billing/get-current-vat-rate.use-case';
import { UPDATE_VAT_RATE_USE_CASE } from '../../domain/ports/in/billing/update-vat-rate.use-case';
import {
  GENERATE_SETTLEMENT_USE_CASE,
  GenerateSettlementUseCase,
} from '../../domain/ports/in/settlement/generate-settlement.use-case';
import {
  INVOICE_ISSUANCE_REPOSITORY,
  InvoiceIssuanceRepositoryPort,
} from '../../domain/ports/out/billing/invoice-issuance.repository.port';
import {
  VAT_RATE_REPOSITORY,
  VatRateRepositoryPort,
} from '../../domain/ports/out/billing/vat-rate.repository.port';
import { VatRateAdminController } from '../adapters/in/http/billing/vat-rate-admin.controller';
import { PrismaInvoiceIssuanceRepository } from '../adapters/out/persistence/repositories/billing/prisma-invoice-issuance.repository';
import { PrismaVatRateRepository } from '../adapters/out/persistence/repositories/billing/prisma-vat-rate.repository';
import { LoggedGenerateFinalInvoiceUseCase } from '../logging/billing/logged-generate-final-invoice.use-case';
import { AuthModule } from './auth.module';
import { SettlementModule } from './settlement.module';

// Bounded context `billing`: binding puerto → adaptador por token (regla 4 del plan base).
// Los servicios de aplicación no tienen decoradores de NestJS: se construyen aquí.
@Module({
  // settlement exporta GENERATE_SETTLEMENT_USE_CASE: 006 incluye a 007 (FR-001). settlement
  // nunca importa billing, así que no hay dependencia circular.
  imports: [AuthModule, SettlementModule],
  controllers: [VatRateAdminController],
  providers: [
    // 001 — porcentaje de IVA
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

    // 006 — factura final. Sin controller: solo la invoca 010 (FR-001, BR-001).
    { provide: INVOICE_ISSUANCE_REPOSITORY, useClass: PrismaInvoiceIssuanceRepository },
    {
      provide: GENERATE_FINAL_INVOICE_USE_CASE,
      inject: [
        GENERATE_SETTLEMENT_USE_CASE,
        GET_CURRENT_VAT_RATE_USE_CASE,
        INVOICE_ISSUANCE_REPOSITORY,
      ],
      useFactory: (
        settlements: GenerateSettlementUseCase,
        vatRates: GetCurrentVatRateUseCase,
        invoices: InvoiceIssuanceRepositoryPort,
      ) =>
        new LoggedGenerateFinalInvoiceUseCase(
          new GenerateFinalInvoiceService(settlements, vatRates, invoices),
        ),
    },
  ],
  // 006 lee el IVA solo por GET_CURRENT_VAT_RATE_USE_CASE, nunca por el repositorio.
  // 010 (Registrar check-out) inyecta GENERATE_FINAL_INVOICE_USE_CASE.
  exports: [GET_CURRENT_VAT_RATE_USE_CASE, GENERATE_FINAL_INVOICE_USE_CASE],
})
export class BillingModule {}
