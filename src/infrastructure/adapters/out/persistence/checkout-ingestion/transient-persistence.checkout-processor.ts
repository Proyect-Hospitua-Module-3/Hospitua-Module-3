// Feature 010 · Registrar Check-out
import { DomainError } from '../../../../../domain/errors/domain.error';
import { CheckoutPersistenceUnavailableError } from '../../../../../domain/errors/checkout-ingestion/checkout-persistence-unavailable.error';
import { CheckoutEvent } from '../../../../../domain/model/checkout-ingestion/checkout-event';
import {
  CheckoutEventProcessorPort,
  CheckoutProcessingResult,
} from '../../../../../domain/ports/out/checkout-ingestion/checkout-event-processor.port';
import { isTransientPersistenceError } from '../transient-persistence-error';

// Decorador del procesador (contrato EVENT-facturacion-checkout, DATABASE_UNAVAILABLE).
// 006 ya traduce sus fallas de base de datos a DATABASE_UNAVAILABLE, pero 007 (leer o
// guardar la liquidación) y la lectura de cotizaciones de 005 dejan pasar el error crudo
// de Prisma. Sin esta traducción, RegisterCheckoutService lo vería como UNEXPECTED_ERROR
// y mandaría el evento a la DLQ sin reintentar. Vive en infraestructura porque reconocer
// un error de Prisma es un detalle de la persistencia, no de la aplicación.
export class TransientPersistenceCheckoutProcessor implements CheckoutEventProcessorPort {
  constructor(private readonly inner: CheckoutEventProcessorPort) {}

  async process(event: CheckoutEvent): Promise<CheckoutProcessingResult> {
    try {
      return await this.inner.process(event);
    } catch (error) {
      if (!(error instanceof DomainError) && isTransientPersistenceError(error)) {
        throw new CheckoutPersistenceUnavailableError(error);
      }
      throw error;
    }
  }
}
