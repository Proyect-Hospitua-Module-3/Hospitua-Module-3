// Feature 003 · Consultar porcentaje de comisión OTA
import { Controller, Get, Inject, Param, Req, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { Request } from 'express';
import {
  INTERNAL_OTA_COMMISSION_CALLER,
  OtaCommissionCaller,
} from '../../../../../domain/model/ota-commission/ota-commission-query';
import { OtaCommissionResult } from '../../../../../domain/model/ota-commission/ota-commission-reference';
import {
  GET_LATEST_OTA_COMMISSION_USE_CASE,
  GetLatestOtaCommissionUseCase,
} from '../../../../../domain/ports/in/ota-commission/get-latest-ota-commission.use-case';
import { AuthenticatedUser } from '../auth/authenticated-user';
import { OptionalJwtAuthGuard } from '../auth/optional-jwt-auth.guard';
import { OtaCommissionDto } from './dto/ota-commission.dto';
import { OtaCommissionAccessGuard } from './ota-commission-access.guard';

// Adaptador de entrada sin lógica de negocio: mapea HTTP ↔ caso de uso. Módulo 2 llama sin
// token; la OTA, con su JWT (OtaCommissionAccessGuard). Solo GET: no hay ninguna ruta para
// crear, corregir ni fijar porcentajes (FR-005, SC-004).
// @ApiBearerAuth: Swagger envía el token si se autorizó (OTA); Módulo 2 no lo envía.
@ApiTags('Comisión OTA (Módulo 2 y OTA)')
@ApiBearerAuth()
@Controller('ota-commission')
export class OtaCommissionController {
  constructor(
    @Inject(GET_LATEST_OTA_COMMISSION_USE_CASE)
    private readonly getLatestOtaCommission: GetLatestOtaCommissionUseCase,
  ) {}

  @Get(':otaId')
  @UseGuards(OptionalJwtAuthGuard, OtaCommissionAccessGuard)
  @ApiOperation({
    summary: 'Porcentaje de comisión de la liquidación Final más reciente de una OTA (referencial)',
    description:
      'Dato histórico y referencial, no contractual: la fuente del porcentaje de una reserva es Módulo 2. Módulo 2 llama sin token y puede consultar cualquier OTA; una OTA llama con su token y solo puede consultar su propio otaId. Sin historial responde historical: false, sin porcentaje.',
  })
  @ApiParam({
    name: 'otaId',
    example: 'booking',
    description: 'Identificador de la OTA. El valor reservado DIRECT (canal directo) se rechaza.',
  })
  @ApiOkResponse({ type: OtaCommissionDto })
  @ApiBadRequestResponse({
    description: 'INVALID_QUERY_PARAMS: otaId es DIRECT (canal directo, no es una OTA) o está vacío',
  })
  @ApiUnauthorizedResponse({
    description: 'UNAUTHENTICATED: token inválido o expirado, o token OTA sin otaId',
  })
  @ApiForbiddenResponse({
    description: 'FORBIDDEN: una OTA consulta otra OTA, o el token es de un rol distinto de OTA',
  })
  @ApiUnprocessableEntityResponse({ description: 'UNEXPECTED_ERROR' })
  async get(@Param('otaId') otaId: string, @Req() request: Request): Promise<OtaCommissionDto> {
    const result = await this.getLatestOtaCommission.execute(
      otaId,
      callerOf(request.user as AuthenticatedUser | undefined),
    );
    return toDto(result);
  }
}

// Sin usuario: llamada interna (Módulo 2). Con usuario: OtaCommissionAccessGuard ya exigió
// el rol OTA y el claim otaId.
function callerOf(user: AuthenticatedUser | undefined): OtaCommissionCaller {
  return user ? { kind: 'OTA', otaId: user.otaId ?? '' } : INTERNAL_OTA_COMMISSION_CALLER;
}

// historical: true marca siempre el dato como histórico y referencial (FR-002). Sin
// historial no se envía ningún porcentaje, ni siquiera 0 (FR-004).
function toDto(result: OtaCommissionResult): OtaCommissionDto {
  if (result.kind === 'NO_HISTORY') {
    return { otaId: result.otaId, historical: false };
  }
  const { reference } = result;
  return {
    otaId: reference.otaId,
    historical: true,
    percentage: reference.percentage.toString(),
    settlementId: reference.settlementId,
    settlementDate: reference.settlementDate.toISOString(),
  };
}
