// Feature 010 · Registrar Check-out
import { CheckoutEvent } from '../../../domain/model/checkout-ingestion/checkout-event';
import { GenerateFinalInvoiceUseCase } from '../../../domain/ports/in/billing/generate-final-invoice.use-case';
import {
  GenerateSettlementCommand,
  GenerateSettlementUseCase,
} from '../../../domain/ports/in/settlement/generate-settlement.use-case';
import {
  CheckoutEventProcessorPort,
  CheckoutProcessingResult,
} from '../../../domain/ports/out/checkout-ingestion/checkout-event-processor.port';

// Nota de auditoría del contrato (sección 4, regla 5) para un PROCESSED sin factura.
export const INVOICE_NOT_ISSUED_NOTE =
  'Factura no emitida: datos tributarios ausentes o incompletos';

// Paso de negocio de un evento válido (T010, plan 010 "Orquestación", reglas 4 y 5):
// Generar liquidación (007) y después Generar factura final (006). 006 vuelve a invocar
// 007 internamente y la idempotencia por stayId devuelve la misma liquidación, sin
// duplicarla ni volver a consultar Módulo 2.
//
// No captura errores: llegan a RegisterCheckoutService como DomainError con su
// errorCode, y él decide si el evento va a la cola de reintento o a la DLQ. Si 007 falla,
// 006 no se invoca.
export class CheckoutEventProcessorService implements CheckoutEventProcessorPort {
  constructor(
    private readonly settlements: GenerateSettlementUseCase,
    private readonly invoices: GenerateFinalInvoiceUseCase,
  ) {}

  async process(event: CheckoutEvent): Promise<CheckoutProcessingResult> {
    const checkout: GenerateSettlementCommand = {
      eventId: event.eventId,
      stayId: event.stayId,
      reservationRef: event.reservationRef,
      roomId: event.roomId,
      categoryRoom: event.categoryRoom,
      checkInDate: event.checkInDate,
      checkOutDate: event.checkOutDate,
    };

    // 007 nunca recibe los datos tributarios.
    await this.settlements.generate(checkout);

    // Solo 006 recibe billingCustomer, tal como llegó: 006 decide si bastan para emitir.
    const invoice = await this.invoices.generate({
      ...checkout,
      billingCustomer: event.billingCustomer,
    });

    // Sin datos tributarios es un resultado normal: la liquidación queda guardada y el
    // evento se confirma como PROCESSED con nota (FR-008 de 006, contrato regla 5).
    return { resultNote: invoice.status === 'NOT_ISSUED' ? INVOICE_NOT_ISSUED_NOTE : null };
  }
}
