// Feature 010 · Registrar Check-out
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CheckoutEventProcessorService } from '../../application/services/checkout-ingestion/checkout-event-processor.service';
import { RegisterCheckoutService } from '../../application/services/checkout-ingestion/register-checkout.service';
import {
  GENERATE_FINAL_INVOICE_USE_CASE,
  GenerateFinalInvoiceUseCase,
} from '../../domain/ports/in/billing/generate-final-invoice.use-case';
import {
  GENERATE_SETTLEMENT_USE_CASE,
  GenerateSettlementUseCase,
} from '../../domain/ports/in/settlement/generate-settlement.use-case';
import {
  CHECKOUT_EVENT_LOG_REPOSITORY,
  CheckoutEventLogRepositoryPort,
} from '../../domain/ports/out/checkout-ingestion/checkout-event-log.repository.port';
import {
  CHECKOUT_EVENT_PROCESSOR,
  CheckoutEventProcessorPort,
} from '../../domain/ports/out/checkout-ingestion/checkout-event-processor.port';
import { TransientPersistenceCheckoutProcessor } from '../adapters/out/persistence/checkout-ingestion/transient-persistence.checkout-processor';
import { PrismaCheckoutEventLogRepository } from '../adapters/out/persistence/repositories/checkout-ingestion/prisma-checkout-event-log.repository';
import { checkoutLogWriter } from '../logging/checkout-ingestion/checkout-log-writer';
import { BillingModule } from './billing.module';
import { RabbitMqCheckoutRunner } from './rabbitmq-checkout.runner';
import { SettlementModule } from './settlement.module';

// Bounded context `checkout-ingestion`: binding puerto → adaptador por token (regla 4 del
// plan base). Los servicios de aplicación no tienen decoradores de NestJS: se construyen aquí.
// Sin controllers: la única entrada es la cola modulo3.checkout (FR-001).
@Module({
  // settlement exporta GENERATE_SETTLEMENT_USE_CASE (007) y billing,
  // GENERATE_FINAL_INVOICE_USE_CASE (006). Ninguno de los dos importa checkout-ingestion.
  imports: [SettlementModule, BillingModule],
  providers: [
    { provide: CHECKOUT_EVENT_LOG_REPOSITORY, useClass: PrismaCheckoutEventLogRepository },
    {
      provide: CHECKOUT_EVENT_PROCESSOR,
      inject: [GENERATE_SETTLEMENT_USE_CASE, GENERATE_FINAL_INVOICE_USE_CASE],
      // Una falla transitoria de la base de datos sin tipo (de 007 o de las cotizaciones de
      // 005) sale como DATABASE_UNAVAILABLE y va a reintento, no a la DLQ.
      useFactory: (settlements: GenerateSettlementUseCase, invoices: GenerateFinalInvoiceUseCase) =>
        new TransientPersistenceCheckoutProcessor(
          new CheckoutEventProcessorService(settlements, invoices),
        ),
    },
    {
      // El publicador necesita el canal con confirms, que solo existe al conectar: por eso
      // RegisterCheckoutService lo construye el runner, con estas dependencias.
      provide: RabbitMqCheckoutRunner,
      inject: [ConfigService, CHECKOUT_EVENT_LOG_REPOSITORY, CHECKOUT_EVENT_PROCESSOR],
      useFactory: (
        config: ConfigService,
        eventLogs: CheckoutEventLogRepositoryPort,
        processor: CheckoutEventProcessorPort,
      ) =>
        new RabbitMqCheckoutRunner(
          config,
          (publisher) =>
            new RegisterCheckoutService(eventLogs, publisher, processor, checkoutLogWriter()),
        ),
    },
  ],
})
export class CheckoutIngestionModule {}
