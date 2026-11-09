// Feature 001 · Actualizar porcentaje de IVA
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Put,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
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
  GET_VAT_RATE_OVERVIEW_USE_CASE,
  GetVatRateOverviewUseCase,
} from '../../../../../domain/ports/in/billing/get-vat-rate-overview.use-case';
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
import { VatRateOverviewResponseDto } from './dto/vat-rate-overview.dto';

// Adaptador de entrada sin lógica de negocio: mapea HTTP ↔ caso de uso.
// Los guards corren antes que la validación: 401/403 nunca llegan a mirar el cuerpo.
@ApiTags('Administración - IVA')
@ApiBearerAuth()
@Controller('admin/vat-rate')
@UseGuards(JwtAuthGuard, RolesGuard)
export class VatRateAdminController {
  constructor(
    @Inject(UPDATE_VAT_RATE_USE_CASE) private readonly updateVatRate: UpdateVatRateUseCase,
    @Inject(GET_VAT_RATE_OVERVIEW_USE_CASE)
    private readonly vatRateOverview: GetVatRateOverviewUseCase,
  ) {}

  // Pantalla "Porcentaje de IVA" del frontend: vigente + historial (contrato
  // GET-admin-vat-rate.md). Sin porcentaje registrado responde 200 con current = null.
  @Get()
  @Roles('Administrador')
  @ApiOkResponse({ type: VatRateOverviewResponseDto })
  @ApiUnauthorizedResponse({ description: 'UNAUTHENTICATED' })
  @ApiForbiddenResponse({ description: 'FORBIDDEN: el rol no es Administrador' })
  @ApiUnprocessableEntityResponse({ description: 'UNEXPECTED_ERROR' })
  async overview(): Promise<VatRateOverviewResponseDto> {
    const { current, history } = await this.vatRateOverview.getOverview();
    return {
      current: current && { ...current, updatedAt: current.updatedAt.toISOString() },
      history: history.map((change) => ({
        ...change,
        changedAt: change.changedAt.toISOString(),
      })),
    };
  }

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
