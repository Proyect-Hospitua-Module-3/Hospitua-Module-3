// Feature 009 · Modificar precio tarifa según temporada
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Min } from 'class-validator';

// Primer filtro: tipos básicos. Formato, rango y reglas los valida el dominio.
// No se aceptan campos que genera el servidor (seasonId, isDefault, version…): el
// ValidationPipe del controller rechaza cualquier propiedad que no esté aquí.

export class CreateSeasonDto {
  @ApiProperty({ example: 'Festival' })
  @IsString()
  name: string;

  @ApiProperty({ example: '#C0392B', description: 'Color hexadecimal #RRGGBB' })
  @IsString()
  color: string;

  @ApiProperty({
    example: '25.00',
    description: 'Porcentaje firmado entre -100.00 y 100.00, como texto',
  })
  @IsString()
  adjustmentPercent: string;
}

export class UpdateSeasonDto {
  @ApiPropertyOptional({ example: 'Temporada alta' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ example: '#E67E22' })
  @IsOptional()
  @IsString()
  color?: string;

  @ApiPropertyOptional({ example: '-10.00' })
  @IsOptional()
  @IsString()
  adjustmentPercent?: string;

  @ApiPropertyOptional({
    example: 1,
    description: 'Versión que leíste; si ya cambió, se responde 409 SEASON_RULE_CONFLICT',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  expectedVersion?: number;
}

export class SeasonResponseDto {
  @ApiProperty({ example: '5dca644e-7a6a-4d2e-a9a5-1943188c4710' })
  seasonId: string;

  @ApiProperty({ example: 'Festival' })
  name: string;

  @ApiProperty({ example: '#C0392B' })
  color: string;

  @ApiProperty({ example: '25.00' })
  adjustmentPercent: string;

  @ApiProperty({ example: false })
  isDefault: boolean;

  @ApiProperty({ example: 1 })
  version: number;

  @ApiProperty({ example: '2026-10-09T20:12:00.000Z' })
  validFrom: string;

  @ApiProperty({ description: 'Administrador del último cambio (sub del token)' })
  updatedBy: string;

  @ApiProperty({ example: '2026-10-09T20:12:00.000Z' })
  updatedAt: string;
}

export class SeasonCatalogResponseDto {
  @ApiProperty({ example: '2026-10-09T20:15:00.000Z' })
  asOf: string;

  @ApiProperty({ type: [SeasonResponseDto] })
  seasons: SeasonResponseDto[];
}
