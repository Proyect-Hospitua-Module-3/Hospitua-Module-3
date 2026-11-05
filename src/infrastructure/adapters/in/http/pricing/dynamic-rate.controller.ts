// Feature 005 · Consultar tarifa dinámica
import { Controller, Get, Inject, Query, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiFailedDependencyResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import {
  GET_DYNAMIC_RATE_USE_CASE,
  GetDynamicRateUseCase,
} from '../../../../../domain/ports/in/pricing/get-dynamic-rate.use-case';
import { OptionalJwtAuthGuard } from '../auth/optional-jwt-auth.guard';
import { DynamicRateQueryDto, DynamicRateResponseDto } from './dto/dynamic-rate.dto';
import { InternalCallOnlyGuard } from './internal-call-only.guard';
import { pricingRequestPipe } from './pricing-validation';

// Adaptador de entrada sin lógica de negocio: mapea HTTP ↔ caso de uso.
// Módulo 2 llama sin token. Un token inválido → 401; uno válido → 403 por ahora: la
// OTA (HU4) se habilita cuando exista el cliente de Módulo 2 de 007, cambiando
// InternalCallOnlyGuard por RolesGuard con @Roles('OTA').
// @ApiBearerAuth: Swagger envía el token si se autorizó (para probar el 401/403); Módulo 2
// no lo envía.
@ApiTags('Tarifa dinámica (Módulo 2)')
@ApiBearerAuth()
@Controller('pricing')
export class DynamicRateController {
  constructor(
    @Inject(GET_DYNAMIC_RATE_USE_CASE) private readonly getDynamicRate: GetDynamicRateUseCase,
  ) {}

  @Get('dynamic-rate')
  @UseGuards(OptionalJwtAuthGuard, InternalCallOnlyGuard)
  @ApiOperation({
    summary: 'Tarifa dinámica de una habitación, noche por noche',
    description: 'Envía date (una noche) o checkInDate y checkOutDate (salida exclusiva).',
  })
  @ApiOkResponse({ type: DynamicRateResponseDto })
  @ApiBadRequestResponse({ description: 'INVALID_QUERY_PARAMS o INVALID_DATE_RANGE' })
  @ApiUnauthorizedResponse({ description: 'UNAUTHENTICATED: token inválido o expirado' })
  @ApiForbiddenResponse({ description: 'FORBIDDEN: llamada con token' })
  @ApiNotFoundResponse({ description: 'ROOM_NOT_FOUND' })
  @ApiFailedDependencyResponse({ description: 'INVALID_BASE_RATE o MODULE1_UNAVAILABLE' })
  @ApiUnprocessableEntityResponse({ description: 'UNEXPECTED_ERROR' })
  async get(
    @Query(pricingRequestPipe) query: DynamicRateQueryDto,
  ): Promise<DynamicRateResponseDto> {
    const result = await this.getDynamicRate.execute({
      roomId: query.roomId,
      date: query.date,
      checkInDate: query.checkInDate,
      checkOutDate: query.checkOutDate,
    });
    return {
      roomId: result.roomId,
      currency: result.currency,
      nights: result.nights.map((night) => ({
        date: night.date.toString(),
        baseRate: night.baseRate.toString(),
        seasonName: night.seasonName,
        seasonAdjustmentPercent: night.adjustmentPercent.toString(),
        dynamicRate: night.dynamicRate.toString(),
      })),
      total: result.total.toString(),
    };
  }
}
