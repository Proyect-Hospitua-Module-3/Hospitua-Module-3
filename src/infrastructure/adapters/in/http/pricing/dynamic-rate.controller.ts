// Feature 005 · Consultar tarifa dinámica
import { Controller, Get, Inject, Query, Req, UseGuards } from '@nestjs/common';
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
import { Request } from 'express';
import {
  DynamicRateCaller,
  GET_DYNAMIC_RATE_USE_CASE,
  GetDynamicRateUseCase,
  INTERNAL_CALLER,
} from '../../../../../domain/ports/in/pricing/get-dynamic-rate.use-case';
import { AuthenticatedUser } from '../auth/authenticated-user';
import { OptionalJwtAuthGuard } from '../auth/optional-jwt-auth.guard';
import { DynamicRateQueryDto, DynamicRateResponseDto } from './dto/dynamic-rate.dto';
import { InternalOrOtaGuard } from './internal-or-ota.guard';
import { pricingRequestPipe } from './pricing-validation';

// Adaptador de entrada sin lógica de negocio: mapea HTTP ↔ caso de uso.
// Módulo 2 llama sin token; la OTA, con su JWT y reservationRef (HU4). Token inválido →
// 401; token de otro rol → 403. Que la habitación sea de una reserva de la OTA lo valida
// el caso de uso, que recibe quién consulta.
// @ApiBearerAuth: Swagger envía el token si se autorizó (OTA); Módulo 2 no lo envía.
@ApiTags('Tarifa dinámica (Módulo 2)')
@ApiBearerAuth()
@Controller('pricing')
export class DynamicRateController {
  constructor(
    @Inject(GET_DYNAMIC_RATE_USE_CASE) private readonly getDynamicRate: GetDynamicRateUseCase,
  ) {}

  @Get('dynamic-rate')
  @UseGuards(OptionalJwtAuthGuard, InternalOrOtaGuard)
  @ApiOperation({
    summary: 'Tarifa dinámica de una habitación, noche por noche (Módulo 2 y OTA)',
    description:
      'Envía date (una noche) o checkInDate y checkOutDate (salida exclusiva). Módulo 2 llama sin token; la OTA, con su token y el reservationRef de una reserva suya.',
  })
  @ApiOkResponse({ type: DynamicRateResponseDto })
  @ApiBadRequestResponse({
    description: 'INVALID_QUERY_PARAMS (también: la OTA sin reservationRef) o INVALID_DATE_RANGE',
  })
  @ApiUnauthorizedResponse({ description: 'UNAUTHENTICATED: token inválido o expirado' })
  @ApiForbiddenResponse({
    description:
      'FORBIDDEN: token que no es de OTA, o habitación que no es de una reserva de la OTA',
  })
  @ApiNotFoundResponse({ description: 'ROOM_NOT_FOUND' })
  @ApiFailedDependencyResponse({
    description: 'INVALID_BASE_RATE, MODULE1_UNAVAILABLE o MODULE2_UNAVAILABLE (solo OTA)',
  })
  @ApiUnprocessableEntityResponse({ description: 'UNEXPECTED_ERROR' })
  async get(
    @Query(pricingRequestPipe) query: DynamicRateQueryDto,
    @Req() request: Request,
  ): Promise<DynamicRateResponseDto> {
    const result = await this.getDynamicRate.execute(
      {
        roomId: query.roomId,
        date: query.date,
        checkInDate: query.checkInDate,
        checkOutDate: query.checkOutDate,
        reservationRef: query.reservationRef,
      },
      callerOf(request.user as AuthenticatedUser | undefined),
    );
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

// Sin usuario: llamada interna de Módulo 2. Con usuario: InternalOrOtaGuard ya exigió el
// rol OTA. Un token de OTA sin otaId no coincide con ninguna reserva y termina en 403.
function callerOf(user: AuthenticatedUser | undefined): DynamicRateCaller {
  return user ? { kind: 'OTA', otaId: user.otaId ?? '' } : INTERNAL_CALLER;
}
