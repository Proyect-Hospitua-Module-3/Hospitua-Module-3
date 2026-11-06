// Feature 005 · Consultar tarifa dinámica
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

// Primer filtro: que cada parámetro llegue una sola vez y como texto. El formato, la
// combinación date / checkInDate + checkOutDate y el rango los valida el caso de uso.
export class DynamicRateQueryDto {
  @ApiProperty({ example: '3f2b8c1e-5a47-4d09-9b6e-1c2d3e4f5a6b' })
  @IsString()
  roomId: string;

  @ApiPropertyOptional({
    example: '2026-12-24',
    description: 'Una sola noche; no se combina con checkInDate/checkOutDate',
  })
  @IsOptional()
  @IsString()
  date?: string;

  @ApiPropertyOptional({ example: '2026-12-23', description: 'Primera noche del rango' })
  @IsOptional()
  @IsString()
  checkInDate?: string;

  @ApiPropertyOptional({
    example: '2026-12-26',
    description: 'Fecha de salida, exclusiva: esa noche no se cobra',
  })
  @IsOptional()
  @IsString()
  checkOutDate?: string;
}

export class DynamicRateNightDto {
  @ApiProperty({ example: '2026-12-24' })
  date: string;

  @ApiProperty({ example: '300000.00', description: 'Tarifa base de Módulo 1' })
  baseRate: string;

  @ApiProperty({ example: 'Alta' })
  seasonName: string;

  @ApiProperty({ example: '20.00', description: 'Ajuste firmado, de -100.00 a 100.00' })
  seasonAdjustmentPercent: string;

  @ApiProperty({ example: '360000.00' })
  dynamicRate: string;
}

export class DynamicRateResponseDto {
  @ApiProperty({ example: '3f2b8c1e-5a47-4d09-9b6e-1c2d3e4f5a6b' })
  roomId: string;

  @ApiProperty({ example: 'COP' })
  currency: string;

  @ApiProperty({ type: [DynamicRateNightDto] })
  nights: DynamicRateNightDto[];

  @ApiProperty({ example: '360000.00', description: 'Suma de la dynamicRate de las noches' })
  total: string;
}
