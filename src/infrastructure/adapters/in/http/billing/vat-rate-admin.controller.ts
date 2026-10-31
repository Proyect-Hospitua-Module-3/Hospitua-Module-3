// Feature 001 · Actualizar porcentaje de IVA
import { Body, Controller, HttpCode, Inject, Put, UseGuards, ValidationPipe } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { InvalidVatRateError } from '../../../../../domain/errors/billing/invalid-vat-rate.error';
import {
  UPDATE_VAT_RATE_USE_CASE,
  UpdateVatRateUseCase,
} from '../../../../../domain/ports/in/billing/update-vat-rate.use-case';
import { AuthenticatedUser } from '../auth/authenticated-user';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { UpdateVatRateDto, VatRateResponseDto } from './dto/update-vat-rate.dto';

// Adaptador de entrada sin lógica de negocio: mapea HTTP ↔ caso de uso.
// Los guards corren antes que la validación: 401/403 nunca llegan a mirar el cuerpo.
@ApiTags('Administración - IVA')
@ApiBearerAuth()
@Controller('admin/vat-rate')
@UseGuards(JwtAuthGuard, RolesGuard)
export class VatRateAdminController {
  constructor(
    @Inject(UPDATE_VAT_RATE_USE_CASE) private readonly updateVatRate: UpdateVatRateUseCase,
  ) {}

  @Put()
  @HttpCode(200)
  @Roles('Administrador')
  @ApiOkResponse({ type: VatRateResponseDto })
  @ApiBadRequestResponse({ description: 'INVALID_VAT_RATE' })
  @ApiUnauthorizedResponse({ description: 'UNAUTHENTICATED' })
  @ApiForbiddenResponse({ description: 'FORBIDDEN: el rol no es Administrador' })
  @ApiUnprocessableEntityResponse({ description: 'UNEXPECTED_ERROR' })
  async update(
    @Body(new ValidationPipe({ exceptionFactory: () => new InvalidVatRateError() }))
    body: UpdateVatRateDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<VatRateResponseDto> {
    const vatRate = await this.updateVatRate.update({ value: body.value, actorId: user.sub });
    return {
      value: vatRate.value.toString(),
      updatedBy: vatRate.updatedBy,
      updatedAt: vatRate.updatedAt.toISOString(),
    };
  }
}
