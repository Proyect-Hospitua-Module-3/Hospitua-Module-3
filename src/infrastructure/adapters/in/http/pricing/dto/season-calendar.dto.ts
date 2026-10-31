// Feature 011 · Revisar temporada del año
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsInt, IsOptional, IsString, Min, ValidateNested } from 'class-validator';

// Primer filtro: tipos básicos. Fechas, años, rangos y reglas los valida el dominio.
// El ValidationPipe del controller rechaza cualquier propiedad que no esté aquí; por
// ejemplo name, color o adjustmentPercent en una entrada, que son de 009.

export class SeasonCalendarQueryDto {
  @ApiProperty({ example: '2026', description: 'Año del calendario (1 a 9999)' })
  @IsString()
  year: string;

  @ApiPropertyOptional({
    example: '2026-06-01',
    description: 'Inicio de la ventana; va junto con to',
  })
  @IsOptional()
  @IsString()
  from?: string;

  @ApiPropertyOptional({
    example: '2026-08-31',
    description: 'Fin de la ventana (inclusivo); va junto con from',
  })
  @IsOptional()
  @IsString()
  to?: string;

  @ApiPropertyOptional({
    example: '2026-10-09T22:00:00Z',
    description: 'Revisión efectiva en ese instante; no se combina con revision',
  })
  @IsOptional()
  @IsString()
  asOf?: string;

  @ApiPropertyOptional({
    example: '3',
    description: 'Revisión histórica concreta; no se combina con asOf',
  })
  @IsOptional()
  @IsString()
  revision?: string;
}

export class SeasonCalendarEntryDto {
  @ApiPropertyOptional({
    example: 'e6cfa8ed-8b7f-4cb4-bbf8-0678180d1f91',
    description: 'Se conserva para entradas existentes; si no llega, se genera uno',
  })
  @IsOptional()
  @IsString()
  entryId?: string;

  @ApiProperty({
    example: '5dca644e-7a6a-4d2e-a9a5-1943188c4710',
    description: 'Temporada del catálogo (009)',
  })
  @IsString()
  seasonId: string;

  @ApiProperty({ enum: ['BASE', 'EXCEPTION'], example: 'BASE' })
  @IsString()
  kind: string;

  @ApiProperty({ example: '2026-06-01', description: 'Inclusivo; dentro del año que se publica' })
  @IsString()
  startDate: string;

  @ApiProperty({
    example: '2026-08-31',
    description:
      'Inclusivo; un BASE puede llegar hasta el año siguiente, una EXCEPTION es igual a startDate',
  })
  @IsString()
  endDate: string;
}

export class PublishSeasonCalendarDto {
  @ApiPropertyOptional({
    example: 4,
    nullable: true,
    description:
      'Revisión activa que leíste; si ya cambió, se responde 409 SEASON_CALENDAR_CONFLICT. ' +
      'null (o 0) significa que el año aún no tiene revisión',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  expectedRevision?: number | null;

  @ApiProperty({
    type: [SeasonCalendarEntryDto],
    description: 'Lista completa de entradas propias del año; lo que no venga queda eliminado',
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SeasonCalendarEntryDto)
  entries: SeasonCalendarEntryDto[];
}

// --- Respuesta (también documenta Swagger) ---

export class CalendarSeasonResponseDto {
  @ApiProperty({ example: '5dca644e-7a6a-4d2e-a9a5-1943188c4710' })
  seasonId: string;

  @ApiProperty({ example: 'Temporada alta', nullable: true, type: String })
  name: string | null;

  @ApiProperty({ example: '#C0392B', nullable: true, type: String })
  color: string | null;

  @ApiProperty({ example: '25.00', nullable: true, type: String })
  adjustmentPercent: string | null;
}

export class CalendarEntryResponseDto {
  @ApiProperty({ example: 'e6cfa8ed-8b7f-4cb4-bbf8-0678180d1f91' })
  entryId: string;

  @ApiProperty({ enum: ['BASE', 'EXCEPTION'] })
  kind: 'BASE' | 'EXCEPTION';

  @ApiProperty({ example: '2026-06-01' })
  startDate: string;

  @ApiProperty({ example: '2026-08-31' })
  endDate: string;

  @ApiProperty({ type: CalendarSeasonResponseDto })
  season: CalendarSeasonResponseDto;
}

export class CarriedInEntryResponseDto {
  @ApiProperty({ example: '7995b0b5-14b6-4d37-9827-40246f45e1c2' })
  entryId: string;

  @ApiProperty({ example: 2025 })
  ownerYear: number;

  @ApiProperty({ example: 3 })
  ownerRevision: number;

  @ApiProperty({ enum: ['BASE'] })
  kind: 'BASE' | 'EXCEPTION';

  @ApiProperty({ example: '2025-12-20' })
  startDate: string;

  @ApiProperty({ example: '2026-01-10' })
  endDate: string;

  @ApiProperty({ type: CalendarSeasonResponseDto })
  season: CalendarSeasonResponseDto;
}

export class UnclassifiedRangeResponseDto {
  @ApiProperty({ example: '2026-01-11' })
  from: string;

  @ApiProperty({ example: '2026-05-31' })
  to: string;

  @ApiProperty({ enum: ['DEFAULT'] })
  resolvedAs: 'DEFAULT';
}

export class CalendarDatesResponseDto {
  @ApiProperty({ example: '2026-07-01' })
  from: string;

  @ApiProperty({ example: '2026-07-15' })
  to: string;
}

export class CalendarConflictResponseDto {
  @ApiProperty({
    enum: ['OVERLAPPING_SEASON_CALENDAR', 'DUPLICATE_SEASON_EXCEPTION', 'UNKNOWN_SEASON_REFERENCE'],
  })
  code: 'OVERLAPPING_SEASON_CALENDAR' | 'DUPLICATE_SEASON_EXCEPTION' | 'UNKNOWN_SEASON_REFERENCE';

  @ApiProperty({ example: true })
  blocking: true;

  @ApiProperty({ type: CalendarDatesResponseDto })
  dates: CalendarDatesResponseDto;

  @ApiProperty({ type: [String] })
  entryIds: string[];

  @ApiProperty()
  message: string;
}

export class SeasonCalendarResponseDto {
  @ApiProperty({ example: 2026 })
  year: number;

  @ApiProperty({
    example: '2026-10-09T22:00:00.000Z',
    description: 'Instante de referencia de la lectura',
  })
  asOf: string;

  @ApiProperty({ example: 5, description: '0 si el año aún no tiene una revisión publicada' })
  revision: number;

  @ApiProperty({ example: '2026-10-09T21:55:00.000Z', nullable: true, type: String })
  effectiveAt: string | null;

  @ApiProperty({
    nullable: true,
    type: String,
    description: 'Administrador que publicó (sub del token)',
  })
  changedBy: string | null;

  @ApiProperty({ example: '2026-10-09T21:55:00.000Z', nullable: true, type: String })
  changedAt: string | null;

  @ApiProperty({ type: CalendarSeasonResponseDto })
  defaultSeason: CalendarSeasonResponseDto;

  @ApiProperty({ type: [CalendarEntryResponseDto] })
  entries: CalendarEntryResponseDto[];

  @ApiProperty({ type: [CarriedInEntryResponseDto] })
  carriedInEntries: CarriedInEntryResponseDto[];

  @ApiProperty({ type: [UnclassifiedRangeResponseDto] })
  unclassifiedRanges: UnclassifiedRangeResponseDto[];

  @ApiProperty({ type: [CalendarConflictResponseDto] })
  conflicts: CalendarConflictResponseDto[];
}
