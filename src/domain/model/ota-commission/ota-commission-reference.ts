// Feature 003 · Consultar porcentaje de comisión OTA
import { CommissionPercentage } from '../settlement/commission-percentage.vo';

// Porcentaje de comisión registrado en la liquidación Final más reciente de una OTA (HU1).
// Es histórico y referencial: no es una tarifa contractual ni la fuente del porcentaje de
// ninguna reserva, que sigue siendo Módulo 2 (FR-002, BR-001). Inmutable.
// El porcentaje reutiliza el VO de settlement (decimal exacto, 2 decimales): ota-commission
// puede leer de settlement, nunca al revés (BR-004).
export class OtaCommissionReference {
  private constructor(
    readonly otaId: string,
    readonly percentage: CommissionPercentage,
    readonly settlementId: string,
    readonly settlementDate: Date,
  ) {
    Object.freeze(this);
  }

  // Los datos vienen de una liquidación ya guardada por 007, que validó el porcentaje al
  // generarla: un valor fuera de rango aquí es un error de programación o de datos.
  static of(input: {
    otaId: string;
    percentage: string;
    settlementId: string;
    settlementDate: Date;
  }): OtaCommissionReference {
    const percentage = CommissionPercentage.tryParse(input.percentage);
    if (percentage === null) {
      throw new Error(
        `La liquidación ${input.settlementId} tiene un porcentaje de comisión inválido.`,
      );
    }
    return new OtaCommissionReference(
      input.otaId,
      percentage,
      input.settlementId,
      new Date(input.settlementDate.getTime()),
    );
  }
}

// Resultado de la consulta: con historial devuelve la referencia; sin historial lo dice
// explícitamente, sin porcentaje por defecto ni en cero (FR-004).
export type OtaCommissionResult =
  | { readonly kind: 'HISTORICAL'; readonly reference: OtaCommissionReference }
  | { readonly kind: 'NO_HISTORY'; readonly otaId: string };
