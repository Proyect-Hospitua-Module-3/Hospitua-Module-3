// Feature 001 · Actualizar porcentaje de IVA
import { ApiProperty } from '@nestjs/swagger';

export class CurrentVatRateResponseDto {
  @ApiProperty({ example: '19.00' })
  value: string;

  @ApiProperty({ description: 'Identificador del Administrador (sub del token)' })
  updatedBy: string;

  @ApiProperty({ example: 'admin', nullable: true, type: String })
  updatedByUsername: string | null;

  @ApiProperty({ example: '2026-01-01T05:00:00.000Z' })
  updatedAt: string;
}

export class VatRateChangeResponseDto {
  @ApiProperty({
    example: '16.00',
    nullable: true,
    type: String,
    description: 'null en el primer registro',
  })
  valueBefore: string | null;

  @ApiProperty({ example: '19.00' })
  valueAfter: string;

  @ApiProperty()
  changedBy: string;

  @ApiProperty({ example: 'admin', nullable: true, type: String })
  changedByUsername: string | null;

  @ApiProperty({ example: '2026-01-01T05:00:00.000Z' })
  changedAt: string;
}

export class VatRateOverviewResponseDto {
  @ApiProperty({
    type: CurrentVatRateResponseDto,
    nullable: true,
    description: 'null mientras no se haya registrado ningún porcentaje',
  })
  current: CurrentVatRateResponseDto | null;

  @ApiProperty({
    type: [VatRateChangeResponseDto],
    description: 'Del cambio más reciente al más antiguo (hasta 100)',
  })
  history: VatRateChangeResponseDto[];
}
