// Feature 006 · Generar factura final
import { randomUUID } from 'node:crypto';
import { FinalSettlementNotFoundError } from '../../../domain/errors/billing/final-settlement-not-found.error';
import { BillingCustomer } from '../../../domain/model/billing/billing-customer';
import { Invoice } from '../../../domain/model/billing/invoice';
import { InvoiceBreakdown } from '../../../domain/model/billing/invoice-breakdown';
import { CheckoutData } from '../../../domain/model/settlement/checkout-data';
import { Settlement, SETTLEMENT_STATUS } from '../../../domain/model/settlement/settlement';
import {
  BILLING_CUSTOMER_DATA_MISSING,
  GenerateFinalInvoiceCommand,
  GenerateFinalInvoiceResult,
  GenerateFinalInvoiceUseCase,
} from '../../../domain/ports/in/billing/generate-final-invoice.use-case';
import { GetCurrentVatRateUseCase } from '../../../domain/ports/in/billing/get-current-vat-rate.use-case';
import { GenerateSettlementUseCase } from '../../../domain/ports/in/settlement/generate-settlement.use-case';
import { InvoiceIssuanceRepositoryPort } from '../../../domain/ports/out/billing/invoice-issuance.repository.port';

// Sin decoradores de NestJS: la capa de aplicación solo depende del dominio.
// El wiring con sus adaptadores está en infrastructure/config/billing.module.ts.
//
// Orden del contrato UC-generate-final-invoice: comando → idempotencia → liquidación Final
// (007) → datos tributarios → IVA vigente (001) → desglose → emisión atómica. Nada que falle
// antes de la emisión consume número (FR-009, NFR-003).
export class GenerateFinalInvoiceService implements GenerateFinalInvoiceUseCase {
  constructor(
    private readonly settlements: GenerateSettlementUseCase,
    private readonly vatRates: GetCurrentVatRateUseCase,
    private readonly invoices: InvoiceIssuanceRepositoryPort,
    private readonly newInvoiceId: () => string = randomUUID,
  ) {}

  async generate(command: GenerateFinalInvoiceCommand): Promise<GenerateFinalInvoiceResult> {
    // Misma validación que 007 (INVALID_CHECKOUT_EVENT), antes de cualquier IO.
    const checkout = CheckoutData.of(command);

    // Idempotencia primero: un reenvío devuelve la factura con su número y sus valores
    // originales, aunque el IVA vigente haya cambiado (FR-006, FR-007, BR-005).
    const existing = await this.invoices.findByStayId(checkout.stayId);
    if (existing) return issued(existing);

    // 007 devuelve la liquidación existente o la genera; sus errores se propagan. Nunca
    // recibe los datos tributarios.
    const settlement = await this.settlements.generate({
      eventId: checkout.eventId,
      stayId: checkout.stayId,
      reservationRef: checkout.reservationRef,
      roomId: checkout.roomId,
      categoryRoom: checkout.categoryRoom,
      checkInDate: checkout.checkInDate,
      checkOutDate: checkout.checkOutDate,
    });
    assertFinalSettlementOf(settlement, checkout.stayId);

    // Sin datos tributarios completos la liquidación queda guardada y la estancia sin
    // factura; no se lee el IVA ni se asigna número (FR-008, FR-009, BR-004).
    const customer = BillingCustomer.tryFrom(command.billingCustomer);
    if (!customer) {
      return { status: 'NOT_ISSUED', reason: BILLING_CUSTOMER_DATA_MISSING };
    }

    // Se congela el IVA de este momento (BR-005). Sus errores se propagan sin asignar número.
    const vatRate = await this.vatRates.getCurrent();
    const amounts = InvoiceBreakdown.calculate(settlement, vatRate.value);

    const invoice = await this.invoices.issueIfAbsent(
      Invoice.prepare({
        invoiceId: this.newInvoiceId(),
        sourceEventId: checkout.eventId,
        settlement,
        customer,
        amounts,
      }),
    );
    return issued(invoice);
  }
}

function issued(invoice: Invoice): GenerateFinalInvoiceResult {
  return { status: 'ISSUED', invoice };
}

// Guarda de integridad: 007 siempre devuelve la liquidación Final de esa estancia.
function assertFinalSettlementOf(settlement: Settlement, stayId: string): void {
  if (settlement.status !== SETTLEMENT_STATUS || settlement.stayId !== stayId) {
    throw new FinalSettlementNotFoundError(stayId);
  }
}
