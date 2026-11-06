// Feature 005 · Consultar tarifa dinámica
import { Body, Controller, HttpCode, Inject, Post, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiFailedDependencyResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import {
  CREATE_LODGING_QUOTE_USE_CASE,
  CreateLodgingQuoteUseCase,
} from '../../../../../domain/ports/in/pricing/create-lodging-quote.use-case';
import { CreateLodgingQuoteDto, LodgingQuoteResponseDto } from './dto/lodging-quote.dto';
import { InternalCallOnlyGuard } from './internal-call-only.guard';
import { pricingRequestPipe } from './pricing-validation';

// Adaptador de entrada sin lógica de negocio: mapea HTTP ↔ caso de uso.
// Solo Módulo 2, sin token; el guard corre antes que la validación del cuerpo, así que
// una solicitud con token recibe 403 aunque el cuerpo esté mal (FR-016, BR-008).
// @ApiBearerAuth: Swagger envía el token si se autorizó (para probar el 403).
@ApiTags('Tarifa dinámica (Módulo 2)')
@ApiBearerAuth()
@Controller('pricing')
export class LodgingQuoteController {
  constructor(
    @Inject(CREATE_LODGING_QUOTE_USE_CASE)
    private readonly createLodgingQuote: CreateLodgingQuoteUseCase,
  ) {}

  @Post('quotes')
  @HttpCode(200)
  @UseGuards(InternalCallOnlyGuard)
  @ApiOperation({
    summary: 'Cotiza y guarda el hospedaje de una habitación (Módulo 2, al crear la reserva)',
  })
  @ApiOkResponse({ type: LodgingQuoteResponseDto })
  @ApiBadRequestResponse({ description: 'INVALID_QUERY_PARAMS o INVALID_DATE_RANGE' })
  @ApiForbiddenResponse({ description: 'FORBIDDEN: la solicitud trae token' })
  @ApiNotFoundResponse({ description: 'ROOM_NOT_FOUND' })
  @ApiFailedDependencyResponse({ description: 'INVALID_BASE_RATE o MODULE1_UNAVAILABLE' })
  @ApiUnprocessableEntityResponse({ description: 'UNEXPECTED_ERROR' })
  async create(
    @Body(pricingRequestPipe) body: CreateLodgingQuoteDto,
  ): Promise<LodgingQuoteResponseDto> {
    const quote = await this.createLodgingQuote.create({
      roomId: body.roomId,
      checkInDate: body.checkInDate,
      checkOutDate: body.checkOutDate,
    });
    return {
      quoteId: quote.quoteId,
      currency: quote.currency,
      nightlyRates: quote.nights.map((night) => ({ date: night.date, rate: night.rate })),
      lodgingAmount: quote.lodgingAmount,
    };
  }
}
