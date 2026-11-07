// Feature 002 · Consultar liquidación
import { Controller, Get, Inject, Query, Req, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiExtraModels,
  ApiFailedDependencyResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
  getSchemaPath,
} from '@nestjs/swagger';
import { Request } from 'express';
import {
  INTERNAL_SETTLEMENT_CALLER,
  SettlementCaller,
} from '../../../../../domain/model/settlement/settlement-query';
import { SettlementQueryResult } from '../../../../../domain/model/settlement/settlement-query-result';
import {
  GET_SETTLEMENT_USE_CASE,
  GetSettlementUseCase,
} from '../../../../../domain/ports/in/settlement/get-settlement.use-case';
import { AuthenticatedUser } from '../auth/authenticated-user';
import { OptionalJwtAuthGuard } from '../auth/optional-jwt-auth.guard';
import { CORRELATION_ID_HEADER } from '../correlation-id.middleware';
import { OtaSettlementsDto, SettlementDto, SettlementQueryDto } from './dto/settlement.dto';
import { SettlementAccessGuard } from './settlement-access.guard';

// Adaptador de entrada sin lógica de negocio: mapea HTTP ↔ caso de uso.
// Módulo 1 llama sin token; la OTA, con su JWT. Token inválido o token OTA sin otaId →
// 401; token de otro rol → 403 (SettlementAccessGuard). Los parámetros obligatorios de
// cada actor los valida el caso de uso. Cache-Control: no-store lo pone NoStoreMiddleware.
// @ApiBearerAuth: Swagger envía el token si se autorizó (OTA); Módulo 1 no lo envía.
@ApiTags('Liquidaciones (Módulo 1 y OTA)')
@ApiBearerAuth()
@ApiExtraModels(SettlementDto, OtaSettlementsDto)
@Controller('api/settlements')
export class SettlementsController {
  constructor(
    @Inject(GET_SETTLEMENT_USE_CASE) private readonly getSettlement: GetSettlementUseCase,
  ) {}

  @Get()
  @UseGuards(OptionalJwtAuthGuard, SettlementAccessGuard)
  @ApiOperation({
    summary: 'Liquidación de una habitación (Módulo 1) o de una reserva propia (OTA)',
    description:
      'Módulo 1 llama sin token con reservationRef y roomId: recibe la liquidación FINAL o, si aún no hay check-out, una INFORMATIVE que no se guarda. La OTA llama con su token y reservationRef: recibe las liquidaciones FINAL de su reserva.',
  })
  @ApiOkResponse({
    description: 'Módulo 1: un objeto de liquidación. OTA: { reservationRef, settlements }',
    schema: {
      oneOf: [{ $ref: getSchemaPath(SettlementDto) }, { $ref: getSchemaPath(OtaSettlementsDto) }],
    },
  })
  @ApiBadRequestResponse({
    description: 'INVALID_QUERY_PARAMS: falta reservationRef, o roomId para Módulo 1',
  })
  @ApiUnauthorizedResponse({
    description: 'UNAUTHENTICATED: token inválido o expirado, o token OTA sin otaId',
  })
  @ApiForbiddenResponse({ description: 'FORBIDDEN: token de un rol distinto de OTA' })
  @ApiNotFoundResponse({
    description:
      'SETTLEMENT_NOT_FOUND (OTA), RESERVATION_NOT_FOUND o QUOTE_NOT_FOUND (informativa de Módulo 1)',
  })
  @ApiConflictResponse({
    description: 'MISSING_COMMISSION o INVALID_COMMISSION (informativa de una reserva OTA)',
  })
  @ApiFailedDependencyResponse({ description: 'MODULE2_UNAVAILABLE (informativa)' })
  @ApiUnprocessableEntityResponse({ description: 'UNEXPECTED_ERROR' })
  async get(
    @Query() query: SettlementQueryDto,
    @Req() request: Request,
  ): Promise<SettlementDto | OtaSettlementsDto> {
    const result = await this.getSettlement.execute(
      {
        // Tal como llegan (pueden faltar o repetirse): el caso de uso los valida.
        reservationRef: query.reservationRef,
        roomId: query.roomId,
        correlationId: correlationIdOf(request),
      },
      callerOf(request.user as AuthenticatedUser | undefined),
    );
    if (result.kind === 'SINGLE') {
      return toSettlementDto(result.settlement);
    }
    return {
      reservationRef: result.reservationRef,
      settlements: result.settlements.map(toSettlementDto),
    };
  }
}

// Sin usuario: llamada interna de Módulo 1. Con usuario: SettlementAccessGuard ya exigió
// el rol OTA y el otaId.
function callerOf(user: AuthenticatedUser | undefined): SettlementCaller {
  return user ? { kind: 'OTA', otaId: user.otaId ?? '' } : INTERNAL_SETTLEMENT_CALLER;
}

// CorrelationIdMiddleware siempre deja un valor en la petición.
function correlationIdOf(request: Request): string | undefined {
  const value = request.headers[CORRELATION_ID_HEADER];
  return typeof value === 'string' ? value : undefined;
}

function toSettlementDto(settlement: SettlementQueryResult): SettlementDto {
  const { breakdown, invoice } = settlement;
  return {
    settlementType: settlement.settlementType,
    reservationRef: settlement.reservationRef,
    roomId: settlement.roomId,
    categoryRoom: settlement.categoryRoom,
    channel: settlement.channel,
    otaId: settlement.otaId,
    currency: settlement.currency,
    breakdown: {
      baseLodgingAmount: breakdown.baseLodgingAmount,
      dynamicAdjustmentAmount: breakdown.dynamicAdjustmentAmount,
      lodgingAmount: breakdown.lodgingAmount,
      otaCommissionPercentage: breakdown.otaCommissionPercentage,
      otaCommissionAmount: breakdown.otaCommissionAmount,
      netIncome: breakdown.netIncome,
    },
    invoice: invoice
      ? {
          invoiceId: invoice.invoiceId,
          invoiceNumber: invoice.invoiceNumber,
          issuedAt: invoice.issuedAt.toISOString(),
          vatRateApplied: invoice.vatRateApplied,
          vatAmount: invoice.vatAmount,
          totalAmount: invoice.totalAmount,
          status: invoice.status,
        }
      : null,
    generatedAt: settlement.generatedAt.toISOString(),
  };
}
