// Feature 010 · Registrar Check-out
import { DomainError } from '../domain.error';

// La base de datos no respondió mientras 007 (liquidación) o la lectura de cotizaciones
// de 005 atendían el check-out, y el error llegó sin tipo. Es reintentable: el contrato
// trata DATABASE_UNAVAILABLE como falla transitoria de persistencia (retry hasta 5 veces),
// y 007 y 006 son idempotentes por stayId.
export class CheckoutPersistenceUnavailableError extends DomainError {
  readonly errorCode = 'DATABASE_UNAVAILABLE';

  constructor(readonly cause?: unknown) {
    super(
      'No se pudo acceder a la base de datos al procesar el check-out; la operación puede reintentarse.',
    );
  }
}
