// Feature 009 · Modificar precio tarifa según temporada
// Feature 011 · Revisar temporada del año
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
  Query,
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
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { InvalidCalendarRangeError } from '../../../../../domain/errors/pricing/invalid-calendar-range.error';
import { InvalidSeasonAdjustmentError } from '../../../../../domain/errors/pricing/invalid-season-adjustment.error';
import { InvalidSeasonError } from '../../../../../domain/errors/pricing/invalid-season.error';
import { Season } from '../../../../../domain/model/pricing/season';
import {
  MODIFY_SEASON_RULE_USE_CASE,
  ModifySeasonRuleUseCase,
} from '../../../../../domain/ports/in/pricing/modify-season-rule.use-case';
import {
  REPLACE_SEASON_CALENDAR_USE_CASE,
  ReplaceSeasonCalendarUseCase,
} from '../../../../../domain/ports/in/pricing/replace-season-calendar.use-case';
import {
  REVIEW_SEASON_CALENDAR_USE_CASE,
  ReviewSeasonCalendarUseCase,
  SeasonCalendarView,
} from '../../../../../domain/ports/in/pricing/review-season-calendar.use-case';
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
import {
  PublishSeasonCalendarDto,
  SeasonCalendarQueryDto,
  SeasonCalendarResponseDto,
} from './dto/season-calendar.dto';

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

// 011: cualquier error de forma en la query o el cuerpo del calendario es
// INVALID_CALENDAR_RANGE, el único 400 de su contrato.
function toCalendarValidationError(errors: ValidationError[]): Error {
  return new InvalidCalendarRangeError(
    `Revisa los campos enviados (${validationPaths(errors).join(', ')}): las entradas solo aceptan ` +
      'entryId, seasonId, kind, startDate y endDate como texto, y expectedRevision es un entero o null.',
  );
}

function validationPaths(errors: ValidationError[], parent = ''): string[] {
  return errors.flatMap((error) => {
    const path = parent ? `${parent}.${error.property}` : error.property;
    return error.children && error.children.length > 0
      ? validationPaths(error.children, path)
      : [path];
  });
}

const calendarQuery = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  exceptionFactory: toCalendarValidationError,
});

// `transform` hace falta para validar cada entrada de la lista como SeasonCalendarEntryDto.
const calendarBody = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
  exceptionFactory: toCalendarValidationError,
});

// Adaptador de entrada sin lógica de negocio: mapea HTTP ↔ caso de uso.
// Compartido por 009 (/admin/season-rules) y 011 (/admin/season-calendar), como indica
// el plan base; las dos son operaciones solo del Administrador.
@ApiTags('Administración - Temporadas')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'UNAUTHENTICATED' })
@ApiForbiddenResponse({ description: 'FORBIDDEN: el rol no es Administrador' })
@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('Administrador')
export class SeasonAdminController {
  constructor(
    @Inject(MODIFY_SEASON_RULE_USE_CASE) private readonly seasonRules: ModifySeasonRuleUseCase,
    @Inject(REVIEW_SEASON_CALENDAR_USE_CASE)
    private readonly calendarReview: ReviewSeasonCalendarUseCase,
    @Inject(REPLACE_SEASON_CALENDAR_USE_CASE)
    private readonly calendarPublication: ReplaceSeasonCalendarUseCase,
  ) {}

  // --- 009: catálogo de temporadas ---------------------------------------

  @Get('season-rules')
  @ApiOkResponse({ type: SeasonCatalogResponseDto })
  async list(): Promise<SeasonCatalogResponseDto> {
    const catalog = await this.seasonRules.list();
    return {
      asOf: catalog.asOf.toISOString(),
      seasons: catalog.seasons.map(toResponse),
    };
  }

  @Post('season-rules')
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

  @Put('season-rules/:seasonId')
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

  @Delete('season-rules/:seasonId')
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

  // --- 011: calendario anual de temporadas -------------------------------

  @Get('season-calendar')
  @ApiOkResponse({ type: SeasonCalendarResponseDto })
  @ApiBadRequestResponse({ description: 'INVALID_CALENDAR_RANGE' })
  @ApiNotFoundResponse({ description: 'SEASON_CALENDAR_NOT_FOUND: la revisión pedida no existe' })
  @ApiUnprocessableEntityResponse({ description: 'UNEXPECTED_ERROR' })
  async reviewCalendar(
    @Query(calendarQuery) query: SeasonCalendarQueryDto,
  ): Promise<SeasonCalendarResponseDto> {
    return toCalendarResponse(await this.calendarReview.review(query));
  }

  @Put('season-calendar/:year')
  @HttpCode(200)
  @ApiOkResponse({ type: SeasonCalendarResponseDto })
  @ApiBadRequestResponse({ description: 'INVALID_CALENDAR_RANGE' })
  @ApiConflictResponse({
    description:
      'OVERLAPPING_SEASON_CALENDAR, DUPLICATE_SEASON_EXCEPTION o SEASON_CALENDAR_CONFLICT',
  })
  @ApiUnprocessableEntityResponse({ description: 'UNKNOWN_SEASON_REFERENCE o UNEXPECTED_ERROR' })
  async publishCalendar(
    @Param('year') year: string,
    @Body(calendarBody) body: PublishSeasonCalendarDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<SeasonCalendarResponseDto> {
    const calendar = await this.calendarPublication.replace({
      year,
      expectedRevision: body.expectedRevision,
      entries: body.entries,
      actorId: user.sub,
    });
    return toCalendarResponse(calendar);
  }
}

function toCalendarResponse(calendar: SeasonCalendarView): SeasonCalendarResponseDto {
  return {
    ...calendar,
    asOf: calendar.asOf.toISOString(),
    effectiveAt: calendar.effectiveAt?.toISOString() ?? null,
    changedAt: calendar.changedAt?.toISOString() ?? null,
  };
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
