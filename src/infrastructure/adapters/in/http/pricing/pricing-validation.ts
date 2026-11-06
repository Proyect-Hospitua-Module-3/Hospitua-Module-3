// Feature 005 · Consultar tarifa dinámica
import { ValidationError, ValidationPipe } from '@nestjs/common';
import { InvalidPricingRequestError } from '../../../../../domain/errors/pricing/invalid-pricing-request.error';

// Cualquier error de forma en la query del GET o en el cuerpo del POST es
// INVALID_QUERY_PARAMS (contratos GET y POST de 005). Los campos que no están en el DTO
// se descartan (por ejemplo reservationRef en una llamada interna, que se ignora).
export const pricingRequestPipe = new ValidationPipe({
  whitelist: true,
  exceptionFactory: (errors: ValidationError[]) => {
    // Sin nombre de campo cuando lo que llega no es un objeto (por ejemplo, una lista).
    const fields = errors.map((e) => e.property).filter((property) => Boolean(property));
    return new InvalidPricingRequestError(
      fields.length > 0
        ? `Revisa los campos enviados (${fields.join(', ')}): cada uno se envía una sola vez y como texto.`
        : 'La solicitud debe ser un objeto con roomId y las fechas como texto.',
    );
  },
});
