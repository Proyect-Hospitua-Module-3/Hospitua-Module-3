// Feature 001 · Actualizar porcentaje de IVA
// Contratos: features/001-actualizar-porcentaje-iva/2-technical/contracts/
// GET-admin-vat-rate.md y PUT-admin-vat-rate.md. Porcentajes siempre como texto ("19.00").
import { apiRequest } from './http';

export interface CurrentVatRate {
  value: string;
  updatedBy: string;
  updatedByUsername: string | null;
  updatedAt: string;
}

export interface VatRateChange {
  valueBefore: string | null;
  valueAfter: string;
  changedBy: string;
  changedByUsername: string | null;
  changedAt: string;
}

export interface VatRateOverview {
  // null mientras no se haya registrado ningún porcentaje.
  current: CurrentVatRate | null;
  // Del cambio más reciente al más antiguo.
  history: VatRateChange[];
}

export interface SavedVatRate {
  value: string;
  updatedBy: string;
  updatedAt: string;
}

export function getVatRateOverview(token: string): Promise<VatRateOverview> {
  return apiRequest<VatRateOverview>('/admin/vat-rate', { token });
}

export function updateVatRate(token: string, value: string): Promise<SavedVatRate> {
  return apiRequest<SavedVatRate>('/admin/vat-rate', { method: 'PUT', token, body: { value } });
}
