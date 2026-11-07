// Feature 001 · Actualizar porcentaje de IVA
// Modelo de lectura de la pantalla "Porcentaje de IVA" (contrato GET-admin-vat-rate.md).
// Porcentajes como texto decimal con 2 decimales; nunca como number.

// El porcentaje vigente (FR-003, entidad "Porcentaje de IVA vigente").
export interface CurrentVatRate {
  readonly value: string;
  readonly updatedBy: string;
  // null si el usuario ya no existe en app_user.
  readonly updatedByUsername: string | null;
  readonly updatedAt: Date;
}

// Una entrada del historial (FR-005, entidad "Historial de actualización de IVA").
export interface VatRateChange {
  // null en el primer registro.
  readonly valueBefore: string | null;
  readonly valueAfter: string;
  readonly changedBy: string;
  readonly changedByUsername: string | null;
  readonly changedAt: Date;
}

export interface VatRateOverview {
  // null mientras el Administrador no registre el primer porcentaje (FR-003).
  readonly current: CurrentVatRate | null;
  // Del cambio más reciente al más antiguo.
  readonly history: readonly VatRateChange[];
}
