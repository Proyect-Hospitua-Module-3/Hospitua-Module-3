// Feature 005 · Consultar tarifa dinámica
import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

// Primer filtro: tipos básicos. Formato y rango los valida el caso de uso.
export class CreateLodgingQuoteDto {
  @ApiProperty({ example: '3f2b8c1e-5a47-4d09-9b6e-1c2d3e4f5a6b' })
  @IsString()
  roomId: string;

  @ApiProperty({ example: '2026-12-23', description: 'Fecha de entrada: primera noche' })
  @IsString()
  checkInDate: string;

  @ApiProperty({
    example: '2026-12-26',
    description: 'Fecha de salida, exclusiva: esa noche no se cotiza',
  })
  @IsString()
  checkOutDate: string;
}

export class NightlyRateDto {
  @ApiProperty({ example: '2026-12-24' })
  date: string;

  @ApiProperty({ example: '360000.00' })
  rate: string;
}

export class LodgingQuoteResponseDto {
  @ApiProperty({ example: 'a1f2c3d4-e5b6-4789-8a9b-0c1d2e3f4a5b' })
  quoteId: string;

  @ApiProperty({ example: 'COP' })
  currency: string;

  @ApiProperty({ type: [NightlyRateDto] })
  nightlyRates: NightlyRateDto[];

  @ApiProperty({ example: '1020000.00', description: 'Valor de hospedaje de la habitación' })
  lodgingAmount: string;
}
