// Feature 009 · Modificar precio tarifa según temporada
// Contrato: features/009-modificar-precio-tarifa-segun-temporada/2-technical/contracts/
// ADMIN-season-rules.md. Los porcentajes viajan como texto y el servidor genera la auditoría.
import { apiRequest } from './http';

export interface SeasonRule {
  seasonId: string;
  name: string;
  color: string;
  adjustmentPercent: string;
  isDefault: boolean;
  version: number;
  validFrom: string;
  updatedBy: string;
  updatedAt: string;
}

export interface SeasonCatalog {
  asOf: string;
  seasons: SeasonRule[];
}

export interface SeasonRuleInput {
  name: string;
  color: string;
  adjustmentPercent: string;
}

export function getSeasonRules(token: string): Promise<SeasonCatalog> {
  return apiRequest<SeasonCatalog>('/admin/season-rules', { token });
}

export function createSeasonRule(token: string, input: SeasonRuleInput): Promise<SeasonRule> {
  return apiRequest<SeasonRule>('/admin/season-rules', { method: 'POST', token, body: input });
}

export function updateSeasonRule(
  token: string,
  seasonId: string,
  input: SeasonRuleInput,
  expectedVersion: number,
): Promise<SeasonRule> {
  return apiRequest<SeasonRule>(`/admin/season-rules/${encodeURIComponent(seasonId)}`, {
    method: 'PUT',
    token,
    body: { ...input, expectedVersion },
  });
}

// El contrato de retiro no admite cuerpo ni versión esperada; el servidor comprueba
// la protección de Regular y sus referencias en las revisiones activas del calendario.
export function retireSeasonRule(token: string, seasonId: string): Promise<void> {
  return apiRequest<void>(`/admin/season-rules/${encodeURIComponent(seasonId)}`, {
    method: 'DELETE',
    token,
  });
}
