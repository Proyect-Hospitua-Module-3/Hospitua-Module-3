// Feature 010 · Registrar Check-out
import { Logger } from '@nestjs/common';
import { CheckoutLogEntry } from '../../../application/services/checkout-ingestion/register-checkout.service';

// Log estructurado de cada mensaje (plan 010, "Observabilidad y privacidad"): eventId,
// stayId, resultado, errorCode y duración. La entrada nunca trae datos tributarios ni
// migratorios. Vive en infraestructura para que el servicio no dependa de NestJS.
export function checkoutLogWriter(
  logger: Pick<Logger, 'log' | 'warn'> = new Logger('RegisterCheckout'),
): (entry: CheckoutLogEntry) => void {
  return (entry) => {
    const line = JSON.stringify(entry);
    if (entry.outcome === 'PROCESSED' || entry.outcome === 'DUPLICATE') {
      logger.log(line);
    } else {
      logger.warn(line);
    }
  };
}
