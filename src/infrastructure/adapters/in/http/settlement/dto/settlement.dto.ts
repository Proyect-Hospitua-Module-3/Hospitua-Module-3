// Feature 002 · Consultar liquidación
// Forma pública: contrato GET-settlements.md. Estas clases solo documentan la API en
// Swagger: los parámetros llegan tal cual y los valida el caso de uso según quién consulta.
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SettlementQueryDto {
  @ApiProperty({
    example: 'RES-000123',
    description: 'Referencia de la reserva (texto opaco, no es UUID). Obligatorio siempre',
  })
  reservationRef: string;

  @ApiPropertyOptional({
    example: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
    description:
      'Habitación (UUID). Obligatorio para Módulo 1 (sin token); con token OTA se ignora',
  })
  roomId?: string;

  @ApiPropertyOptional({
    example: 'DOBLE',
    description:
      'Informativo para Módulo 1: no filtra ni se valida, y nunca aparece en la respuesta',
  })
  categoryRoom?: string;

  @ApiPropertyOptional({ example: '2026-10-05', description: 'Se ignora' })
  checkInDate?: string;

  @ApiPropertyOptional({ example: '2026-10-08', description: 'Se ignora' })
  checkOutDate?: string;

  @ApiPropertyOptional({ example: 'OTA', description: 'Se ignora: el canal sale de la reserva' })
  source?: string;
}

export class SettlementBreakdownDto {
  @ApiProperty({ example: '700000.00', description: 'Suma de la tarifa base de las noches' })
  baseLodgingAmount: string;

  @ApiProperty({
    example: '50000.00',
    description: 'lodgingAmount − baseLodgingAmount; puede ser negativo',
  })
  dynamicAdjustmentAmount: string;

  @ApiProperty({ example: '750000.00', description: 'Valor del hospedaje de la cotización' })
  lodgingAmount: string;

  @ApiProperty({
    example: '15.00',
    nullable: true,
    type: String,
    description: 'null en canal directo',
  })
  otaCommissionPercentage: string | null;

  @ApiProperty({ example: '112500.00', description: '"0.00" en canal directo' })
  otaCommissionAmount: string;

  @ApiProperty({ example: '637500.00', description: 'Hospedaje menos comisión, sin IVA' })
  netIncome: string;
}

export class InvoiceSummaryDto {
  @ApiProperty({ example: '7d1c2f0e-4b8a-4c51-9a3e-2f6b1d9c8e01' })
  invoiceId: string;

  @ApiProperty({ example: 1042, description: 'Consecutivo oficial de la factura' })
  invoiceNumber: number;

  @ApiProperty({ example: '2026-10-08T16:05:12.000Z' })
  issuedAt: string;

  @ApiProperty({ example: '19.00' })
  vatRateApplied: string;

  @ApiProperty({ example: '142500.00' })
  vatAmount: string;

  @ApiProperty({ example: '892500.00', description: 'Hospedaje + IVA' })
  totalAmount: string;

  @ApiProperty({ example: 'ISSUED' })
  status: string;
}

export class SettlementDto {
  @ApiProperty({ enum: ['FINAL', 'INFORMATIVE'], example: 'FINAL' })
  settlementType: 'FINAL' | 'INFORMATIVE';

  @ApiProperty({ example: 'RES-000123' })
  reservationRef: string;

  @ApiProperty({ example: 'f47ac10b-58cc-4372-a567-0e02b2c3d479' })
  roomId: string;

  @ApiProperty({
    example: 'DOBLE',
    nullable: true,
    type: String,
    description: 'De la liquidación FINAL; null en la INFORMATIVE',
  })
  categoryRoom: string | null;

  @ApiProperty({ enum: ['DIRECT', 'OTA'], example: 'OTA' })
  channel: 'DIRECT' | 'OTA';

  @ApiProperty({ example: 'booking', nullable: true, type: String })
  otaId: string | null;

  @ApiProperty({ example: 'COP' })
  currency: string;

  @ApiProperty({ type: SettlementBreakdownDto })
  breakdown: SettlementBreakdownDto;

  @ApiProperty({
    type: InvoiceSummaryDto,
    nullable: true,
    description: 'Solo en una FINAL con factura emitida',
  })
  invoice: InvoiceSummaryDto | null;

  @ApiProperty({
    example: '2026-10-08T16:02:00.000Z',
    description: 'FINAL: cuándo se generó. INFORMATIVE: cuándo se calculó',
  })
  generatedAt: string;
}

export class OtaSettlementsDto {
  @ApiProperty({ example: 'RES-000123' })
  reservationRef: string;

  @ApiProperty({ type: [SettlementDto], description: 'Liquidaciones FINAL, ordenadas por roomId' })
  settlements: SettlementDto[];
}
