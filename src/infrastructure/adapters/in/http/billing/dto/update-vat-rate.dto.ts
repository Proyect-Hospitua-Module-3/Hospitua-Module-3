// Feature 001 · Actualizar porcentaje de IVA
import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

// Primer filtro rápido: que `value` llegue como texto. Rango y decimales los valida
// el value object `VatRateValue` en el dominio.
export class UpdateVatRateDto {
  @ApiProperty({
    description: 'Porcentaje de IVA entre 0 y 100, con a lo sumo 2 decimales, como texto',
    example: '19.00',
  })
  @IsString()
  @IsNotEmpty()
  value: string;
}

export class VatRateResponseDto {
  @ApiProperty({ example: '19.00' })
  value: string;

  @ApiProperty({ description: 'Identificador del Administrador (sub del token)' })
  updatedBy: string;

  @ApiProperty({ example: '2026-10-10T14:32:05.000Z' })
  updatedAt: string;
}
