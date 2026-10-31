// Feature 009 · Modificar precio tarifa según temporada
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Put,
  UseGuards,
  ValidationError,
  ValidationPipe,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { InvalidSeasonAdjustmentError } from '../../../../../domain/errors/pricing/invalid-season-adjustment.error';
import { InvalidSeasonError } from '../../../../../domain/errors/pricing/invalid-season.error';
import { Season } from '../../../../../domain/model/pricing/season';
import {
  MODIFY_SEASON_RULE_USE_CASE,
  ModifySeasonRuleUseCase,
} from '../../../../../domain/ports/in/pricing/modify-season-rule.use-case';
import { AuthenticatedUser } from '../auth/authenticated-user';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import {
  CreateSeasonDto,
  SeasonCatalogResponseDto,
  SeasonResponseDto,
  UpdateSeasonDto,
} from './dto/season.dto';

// Un error de tipo solo en adjustmentPercent es INVALID_SEASON_ADJUSTMENT; cualquier
// otro (campos de más, tipos de name/color/expectedVersion) es INVALID_SEASON.
function toSeasonValidationError(errors: ValidationError[]): Error {
  if (errors.length > 0 && errors.every((e) => e.property === 'adjustmentPercent')) {
    return new InvalidSeasonAdjustmentError();
  }
  const fields = errors.map((e) => e.property).join(', ');
  return new InvalidSeasonError(
    `Revisa los campos enviados (${fields}): solo se aceptan name, color y adjustmentPercent ` +
      'como texto, y expectedVersion como entero positivo.',
  );
}

const seasonBody = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  exceptionFactory: toSeasonValidationError,
});

// Adaptador de entrada sin lógica de negocio: mapea HTTP ↔ caso de uso.
// Compartido con 011, que agregará aquí las rutas /admin/season-calendar.
@ApiTags('Administración - Temporadas')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'UNAUTHENTICATED' })
@ApiForbiddenResponse({ description: 'FORBIDDEN: el rol no es Administrador' })
@Controller('admin/season-rules')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('Administrador')
export class SeasonAdminController {
  constructor(
    @Inject(MODIFY_SEASON_RULE_USE_CASE) private readonly seasonRules: ModifySeasonRuleUseCase,
  ) {}

  @Get()
  @ApiOkResponse({ type: SeasonCatalogResponseDto })
  async list(): Promise<SeasonCatalogResponseDto> {
    const catalog = await this.seasonRules.list();
    return {
      asOf: catalog.asOf.toISOString(),
      seasons: catalog.seasons.map(toResponse),
    };
  }

  @Post()
  @HttpCode(201)
  @ApiCreatedResponse({ type: SeasonResponseDto })
  @ApiBadRequestResponse({ description: 'INVALID_SEASON o INVALID_SEASON_ADJUSTMENT' })
  @ApiConflictResponse({ description: 'SEASON_NAME_CONFLICT' })
  async create(
    @Body(seasonBody) body: CreateSeasonDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<SeasonResponseDto> {
    const season = await this.seasonRules.create({ ...body, actorId: user.sub });
    return toResponse(season);
  }

  @Put(':seasonId')
  @HttpCode(200)
  @ApiOkResponse({ type: SeasonResponseDto })
  @ApiBadRequestResponse({ description: 'INVALID_SEASON o INVALID_SEASON_ADJUSTMENT' })
  @ApiNotFoundResponse({ description: 'SEASON_NOT_FOUND' })
  @ApiConflictResponse({
    description: 'SEASON_NAME_CONFLICT, DEFAULT_SEASON_IMMUTABLE o SEASON_RULE_CONFLICT',
  })
  async update(
    @Param('seasonId') seasonId: string,
    @Body(seasonBody) body: UpdateSeasonDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<SeasonResponseDto> {
    const season = await this.seasonRules.update({ ...body, seasonId, actorId: user.sub });
    return toResponse(season);
  }

  @Delete(':seasonId')
  @HttpCode(204)
  @ApiNoContentResponse({ description: 'Temporada retirada del catálogo' })
  @ApiNotFoundResponse({ description: 'SEASON_NOT_FOUND' })
  @ApiConflictResponse({ description: 'DEFAULT_SEASON_IMMUTABLE o SEASON_IN_USE' })
  async retire(
    @Param('seasonId') seasonId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    await this.seasonRules.retire({ seasonId, actorId: user.sub });
  }
}

function toResponse(season: Season): SeasonResponseDto {
  return {
    seasonId: season.id,
    name: season.name.value,
    color: season.color.value,
    adjustmentPercent: season.currentRule.adjustmentPercent.toString(),
    isDefault: season.isDefault,
    version: season.version,
    validFrom: season.currentRule.validFrom.toISOString(),
    updatedBy: season.updatedBy,
    updatedAt: season.updatedAt.toISOString(),
  };
}
