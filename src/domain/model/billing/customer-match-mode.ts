// Feature 008 · Gestionar facturación
// Tipo de coincidencia del nombre del cliente (caso límite «coincidencia parcial»).

// EXACT: el nombre completo, sin distinguir mayúsculas. PARTIAL: el texto dentro del nombre,
// con al menos 3 caracteres. La respuesta siempre informa el modo aplicado.
export const CUSTOMER_MATCH_MODES = ['EXACT', 'PARTIAL'] as const;
export type CustomerMatchMode = (typeof CUSTOMER_MATCH_MODES)[number];

export const DEFAULT_CUSTOMER_MATCH_MODE: CustomerMatchMode = 'EXACT';

export const PARTIAL_MATCH_MIN_LENGTH = 3;
