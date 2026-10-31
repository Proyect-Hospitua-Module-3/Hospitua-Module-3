import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER } from '@nestjs/core';
import { CorrelationIdMiddleware } from './infrastructure/adapters/in/http/correlation-id.middleware';
import { DomainExceptionFilter } from './infrastructure/adapters/in/http/domain-exception.filter';
import { AuthModule } from './infrastructure/config/auth.module';
import { BillingModule } from './infrastructure/config/billing.module';
import { PersistenceModule } from './infrastructure/config/persistence.module';
import { PricingModule } from './infrastructure/config/pricing.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PersistenceModule,
    AuthModule,
    BillingModule,
    PricingModule,
  ],
  providers: [{ provide: APP_FILTER, useClass: DomainExceptionFilter }],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationIdMiddleware).forRoutes('*');
  }
}
