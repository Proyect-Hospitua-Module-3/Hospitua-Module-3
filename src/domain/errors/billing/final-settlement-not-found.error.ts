// Feature 006 · Generar factura final
import { DomainError } from '../domain.error';

// Guarda de integridad sobre lo que devuelve 007: la liquidación no está en estado Final o
// es de otra estancia. En operación normal no ocurre. No es reintentable: 010 manda el
// evento a dead-letter y no se emite factura ni se asigna número (FR-009).
export class FinalSettlementNotFoundError extends DomainError {
  readonly errorCode = 'FINAL_SETTLEMENT_NOT_FOUND';

  constructor(stayId: string) {
    super(`No existe una liquidación Final para la estancia ${stayId}; no se emite la factura.`);
  }
}
