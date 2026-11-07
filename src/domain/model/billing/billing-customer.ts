// Feature 006 · Generar factura final

// Datos tributarios tal como llegan en el evento de check-out de Módulo 1 (pueden faltar).
export interface BillingCustomerInput {
  name?: unknown;
  taxId?: unknown;
}

// Cliente responsable de la factura: nombre o razón social y documento fiscal (FR-008).
// Solo sale del evento de check-out; nunca de la liquidación ni de otra fuente.
export class BillingCustomer {
  private constructor(
    readonly name: string,
    readonly taxId: string,
  ) {
    Object.freeze(this);
  }

  // null si el objeto falta, es parcial o tiene algún campo en blanco: la factura no se
  // emite (FR-009, BR-004). No es un error, por eso no lanza.
  static tryFrom(input: BillingCustomerInput | null | undefined): BillingCustomer | null {
    if (!input) return null;
    const name = filledText(input.name);
    const taxId = filledText(input.taxId);
    return name && taxId ? new BillingCustomer(name, taxId) : null;
  }

  // Reconstruye el cliente guardado en una factura emitida.
  static restore(name: string, taxId: string): BillingCustomer {
    const customer = BillingCustomer.tryFrom({ name, taxId });
    if (!customer) {
      throw new Error('La factura guardada no tiene nombre y documento fiscal del cliente.');
    }
    return customer;
  }
}

function filledText(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  return value === '' ? null : value;
}
