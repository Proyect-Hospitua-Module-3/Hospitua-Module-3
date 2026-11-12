import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER } from '@nestjs/core';
import { CorrelationIdMiddleware } from './infrastructure/adapters/in/http/correlation-id.middleware';
import { DomainExceptionFilter } from './infrastructure/adapters/in/http/domain-exception.filter';
import { AuthModule } from './infrastructure/config/auth.module';
import { BillingModule } from './infrastructure/config/billing.module';
import { CheckoutIngestionModule } from './infrastructure/config/checkout-ingestion.module';
import { OtaCommissionModule } from './infrastructure/config/ota-commission.module';
import { PersistenceModule } from './infrastructure/config/persistence.module';
import { PricingModule } from './infrastructure/config/pricing.module';
import { SettlementModule } from './infrastructure/config/settlement.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PersistenceModule,
    AuthModule,
    BillingModule,
    PricingModule,
    SettlementModule,
    CheckoutIngestionModule,
    // 003: solo lee settlement; ningún otro módulo lo importa (BR-004).
    OtaCommissionModule,
  ],
  providers: [{ provide: APP_FILTER, useClass: DomainExceptionFilter }],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationIdMiddleware).forRoutes('*');
  }
}
