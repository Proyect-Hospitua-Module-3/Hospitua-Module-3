import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GenerateFinalInvoiceService } from '../../application/services/billing/generate-final-invoice.service';
import { GetCurrentVatRateService } from '../../application/services/billing/get-current-vat-rate.service';
import { GetVatRateOverviewService } from '../../application/services/billing/get-vat-rate-overview.service';
import { ManageInvoicesService } from '../../application/services/billing/manage-invoices.service';
import { UpdateVatRateService } from '../../application/services/billing/update-vat-rate.service';
import { isValidTimeZone } from '../../domain/model/billing/issued-date-range';
import { GENERATE_FINAL_INVOICE_USE_CASE } from '../../domain/ports/in/billing/generate-final-invoice.use-case';
import {
  GET_CURRENT_VAT_RATE_USE_CASE,
  GetCurrentVatRateUseCase,
} from '../../domain/ports/in/billing/get-current-vat-rate.use-case';
import { GET_VAT_RATE_OVERVIEW_USE_CASE } from '../../domain/ports/in/billing/get-vat-rate-overview.use-case';
import { MANAGE_INVOICES_USE_CASE } from '../../domain/ports/in/billing/manage-invoices.use-case';
import { UPDATE_VAT_RATE_USE_CASE } from '../../domain/ports/in/billing/update-vat-rate.use-case';
import {
  GENERATE_SETTLEMENT_USE_CASE,
  GenerateSettlementUseCase,
} from '../../domain/ports/in/settlement/generate-settlement.use-case';
import {
  INVOICE_ISSUANCE_REPOSITORY,
  InvoiceIssuanceRepositoryPort,
} from '../../domain/ports/out/billing/invoice-issuance.repository.port';
import { INVOICE_QUERY, InvoiceQueryPort } from '../../domain/ports/out/billing/invoice-query.port';
import {
  VAT_RATE_OVERVIEW_QUERY,
  VatRateOverviewQueryPort,
} from '../../domain/ports/out/billing/vat-rate-overview.query.port';
import {
  VAT_RATE_REPOSITORY,
  VatRateRepositoryPort,
} from '../../domain/ports/out/billing/vat-rate.repository.port';
import { InvoicesAdminController } from '../adapters/in/http/billing/invoices-admin.controller';
import { VatRateAdminController } from '../adapters/in/http/billing/vat-rate-admin.controller';
import { PrismaInvoiceIssuanceRepository } from '../adapters/out/persistence/repositories/billing/prisma-invoice-issuance.repository';
import { PrismaInvoiceQueryAdapter } from '../adapters/out/persistence/repositories/billing/prisma-invoice-query.adapter';
import { PrismaVatRateOverviewQuery } from '../adapters/out/persistence/repositories/billing/prisma-vat-rate-overview.query';
import { PrismaVatRateRepository } from '../adapters/out/persistence/repositories/billing/prisma-vat-rate.repository';
import { LoggedGenerateFinalInvoiceUseCase } from '../logging/billing/logged-generate-final-invoice.use-case';
import { LoggedManageInvoicesUseCase } from '../logging/billing/logged-manage-invoices.use-case';
import { AuthModule } from './auth.module';
import { SettlementModule } from './settlement.module';

// 008: zona de los filtros por fecha y del resumen (NFR-006) si no llega BILLING_REPORTING_TZ.
const DEFAULT_REPORTING_TIME_ZONE = 'America/Bogota';

// Bounded context `billing`: binding puerto → adaptador por token (regla 4 del plan base).
// Los servicios de aplicación no tienen decoradores de NestJS: se construyen aquí.
@Module({
  // settlement exporta GENERATE_SETTLEMENT_USE_CASE: 006 incluye a 007 (FR-001). settlement
  // nunca importa billing, así que no hay dependencia circular.
  imports: [AuthModule, SettlementModule],
  controllers: [VatRateAdminController, InvoicesAdminController],
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
    // Pantalla de IVA del frontend: vigente + historial (GET /admin/vat-rate).
    { provide: VAT_RATE_OVERVIEW_QUERY, useClass: PrismaVatRateOverviewQuery },
    {
      provide: GET_VAT_RATE_OVERVIEW_USE_CASE,
      inject: [VAT_RATE_OVERVIEW_QUERY],
      useFactory: (overview: VatRateOverviewQueryPort) => new GetVatRateOverviewService(overview),
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

    // 008 — consulta de facturas (solo lectura). Puerto propio sin métodos de escritura: no
    // reutiliza INVOICE_ISSUANCE_REPOSITORY de 006 (FR-006, BR-001).
    { provide: INVOICE_QUERY, useClass: PrismaInvoiceQueryAdapter },
    {
      provide: MANAGE_INVOICES_USE_CASE,
      inject: [INVOICE_QUERY, ConfigService],
      useFactory: (invoices: InvoiceQueryPort, config: ConfigService) =>
        new LoggedManageInvoicesUseCase(
          new ManageInvoicesService(invoices, reportingTimeZoneOf(config)),
        ),
    },
  ],
  // 006 lee el IVA solo por GET_CURRENT_VAT_RATE_USE_CASE, nunca por el repositorio.
  // 010 (Registrar check-out) inyecta GENERATE_FINAL_INVOICE_USE_CASE.
  exports: [GET_CURRENT_VAT_RATE_USE_CASE, GENERATE_FINAL_INVOICE_USE_CASE],
})
export class BillingModule {}

// 008: una zona inválida detiene el arranque, en vez de fallar en cada consulta.
function reportingTimeZoneOf(config: ConfigService): string {
  const timeZone = config.get<string>('BILLING_REPORTING_TZ') || DEFAULT_REPORTING_TIME_ZONE;
  if (!isValidTimeZone(timeZone)) {
    throw new Error(
      `BILLING_REPORTING_TZ debe ser una zona horaria IANA, por ejemplo America/Bogota; llegó "${timeZone}".`,
    );
  }
  return timeZone;
}
