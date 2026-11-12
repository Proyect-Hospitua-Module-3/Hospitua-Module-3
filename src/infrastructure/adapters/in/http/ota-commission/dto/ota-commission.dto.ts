// Feature 003 · Consultar porcentaje de comisión OTA
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// Respuesta 200 del contrato GET-ota-commission-otaid.md, sección 5. Solo estos campos:
// nada del huésped ni de liquidaciones de otras OTA (NFR-003, T028).
export class OtaCommissionDto {
  @ApiProperty({ example: 'booking', description: 'OTA consultada' })
  otaId!: string;

  @ApiProperty({
    example: true,
    description:
      'true: hay una liquidación Final de la OTA y el dato es histórico y referencial, no una tarifa contractual. false: no hay historial (sin porcentaje ni valor por defecto).',
  })
  historical!: boolean;

  @ApiPropertyOptional({
    example: '15.00',
    description:
      'Solo si historical = true. Porcentaje de la liquidación Final más reciente, decimal exacto con 2 decimales.',
  })
  percentage?: string;

  @ApiPropertyOptional({
    example: '7d1c2f0e-4b8a-4c51-9a3e-2f6b1d9c8e01',
    description: 'Solo si historical = true. Liquidación de la que proviene el porcentaje.',
  })
  settlementId?: string;

  @ApiPropertyOptional({
    example: '2026-10-08T16:02:00.000Z',
    description: 'Solo si historical = true. Fecha (generated_at) de esa liquidación, en UTC.',
  })
  settlementDate?: string;
}
