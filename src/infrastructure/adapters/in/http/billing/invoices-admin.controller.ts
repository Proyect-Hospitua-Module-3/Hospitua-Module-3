// Feature 008 · Gestionar facturación
import { Controller, Get, Inject, Param, Query, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import {
  InvoiceChannelSummary,
  InvoiceDetail,
  InvoiceSearchItem,
  InvoiceSearchResult,
} from '../../../../../domain/model/billing/invoice-read-models';
import {
  MANAGE_INVOICES_USE_CASE,
  ManageInvoicesUseCase,
} from '../../../../../domain/ports/in/billing/manage-invoices.use-case';
import { AuthenticatedUser } from '../auth/authenticated-user';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import {
  InvoiceDetailDto,
  InvoiceSearchItemDto,
  InvoiceSearchResponseDto,
  InvoiceSummaryQueryDto,
  InvoiceSummaryResponseDto,
  SearchInvoicesQueryDto,
} from './dto/invoices.dto';

// Adaptador de entrada sin lógica de negocio: mapea HTTP ↔ caso de uso. Solo el
// Administrador (FR-010): sin token o con token inválido → 401; otro rol → 403. Los guards
// corren antes que la validación de parámetros, que hace el caso de uso.
// Solo GET: no hay POST, PUT, PATCH ni DELETE sobre /invoices (FR-006).
@ApiTags('Administración - Facturas')
@ApiBearerAuth()
@Controller('invoices')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('Administrador')
export class InvoicesAdminController {
  constructor(
    @Inject(MANAGE_INVOICES_USE_CASE) private readonly manageInvoices: ManageInvoicesUseCase,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Buscar facturas por estancia, reserva, cliente, canal o rango de fechas',
    description:
      'Exige al menos un criterio. Resultado paginado y ordenado por fecha de emisión y número oficial descendentes. Para pedir otras páginas reenvía el asOf de la respuesta.',
  })
  @ApiOkResponse({ type: InvoiceSearchResponseDto })
  @ApiBadRequestResponse({
    description: 'MISSING_SEARCH_CRITERIA, INVALID_DATE_RANGE o INVALID_QUERY_PARAMS',
  })
  @ApiUnauthorizedResponse({ description: 'UNAUTHENTICATED' })
  @ApiForbiddenResponse({ description: 'FORBIDDEN: el rol no es Administrador' })
  @ApiUnprocessableEntityResponse({ description: 'UNEXPECTED_ERROR' })
  async search(
    @Query() query: SearchInvoicesQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<InvoiceSearchResponseDto> {
    // Tal como llegan (pueden faltar o repetirse): el caso de uso los valida.
    const result = await this.manageInvoices.search(
      {
        stayId: query.stayId,
        reservationRef: query.reservationRef,
        customerName: query.customerName,
        customerMatch: query.customerMatch,
        customerTaxId: query.customerTaxId,
        channel: query.channel,
        otaId: query.otaId,
        issuedFrom: query.issuedFrom,
        issuedTo: query.issuedTo,
        page: query.page,
        pageSize: query.pageSize,
        asOf: query.asOf,
      },
      user.sub,
    );
    return toSearchResponseDto(result);
  }

  // Declarada antes de :invoiceId para que "summary" no se tome como un id.
  @Get('summary')
  @ApiOperation({
    summary: 'Resumen consolidado de facturas por canal en un rango de fechas',
    description:
      'Totales de hospedaje, comisión OTA e IVA por canal. El canal directo aparece siempre y cada OTA con facturas históricas aparece aunque no tenga facturas en el rango, en cero.',
  })
  @ApiOkResponse({ type: InvoiceSummaryResponseDto })
  @ApiBadRequestResponse({ description: 'INVALID_DATE_RANGE o INVALID_QUERY_PARAMS' })
  @ApiUnauthorizedResponse({ description: 'UNAUTHENTICATED' })
  @ApiForbiddenResponse({ description: 'FORBIDDEN: el rol no es Administrador' })
  @ApiUnprocessableEntityResponse({ description: 'UNEXPECTED_ERROR' })
  async summary(
    @Query() query: InvoiceSummaryQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<InvoiceSummaryResponseDto> {
    const summary = await this.manageInvoices.summarizeByChannel(
      { issuedFrom: query.issuedFrom, issuedTo: query.issuedTo },
      user.sub,
    );
    return toSummaryResponseDto(summary);
  }

  @Get(':invoiceId')
  @ApiOperation({
    summary: 'Detalle completo y trazable de una factura',
    description:
      'Desglose tal como lo emitió Generar factura final, liquidación de origen y fecha de emisión. La factura es inmutable.',
  })
  @ApiOkResponse({ type: InvoiceDetailDto })
  @ApiBadRequestResponse({ description: 'INVALID_QUERY_PARAMS: invoiceId no es un UUID' })
  @ApiUnauthorizedResponse({ description: 'UNAUTHENTICATED' })
  @ApiForbiddenResponse({ description: 'FORBIDDEN: el rol no es Administrador' })
  @ApiNotFoundResponse({ description: 'INVOICE_NOT_FOUND' })
  @ApiUnprocessableEntityResponse({ description: 'UNEXPECTED_ERROR' })
  async detail(
    @Param('invoiceId') invoiceId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<InvoiceDetailDto> {
    return toDetailDto(await this.manageInvoices.getDetail(invoiceId, user.sub));
  }
}

function toSearchResponseDto(result: InvoiceSearchResult): InvoiceSearchResponseDto {
  return {
    items: result.items.map(toSearchItemDto),
    page: result.page,
    pageSize: result.pageSize,
    totalItems: result.totalItems,
    totalPages: result.totalPages,
    asOf: result.asOf.toISOString(),
    resultStatus: result.resultStatus,
    customerMatchMode: result.customerMatchMode,
  };
}

function toSearchItemDto(item: InvoiceSearchItem): InvoiceSearchItemDto {
  return {
    invoiceId: item.invoiceId,
    invoiceNumber: item.invoiceNumber,
    issuedAt: item.issuedAt.toISOString(),
    stayId: item.stayId,
    reservationRef: item.reservationRef,
    channel: item.channel,
    otaId: item.otaId,
    customerName: item.customerName,
    customerTaxId: item.customerTaxId,
    currency: item.currency,
    totalAmount: item.totalAmount,
  };
}

function toDetailDto(detail: InvoiceDetail): InvoiceDetailDto {
  return {
    invoiceId: detail.invoiceId,
    invoiceNumber: detail.invoiceNumber,
    status: detail.status,
    // Toda factura emitida por 006 es inmutable (BR-003 de generar_factura_final.md).
    immutable: true,
    issuedAt: detail.issuedAt.toISOString(),
    settlementId: detail.settlementId,
    stayId: detail.stayId,
    reservationRef: detail.reservationRef,
    channel: detail.channel,
    otaId: detail.otaId,
    customer: { name: detail.customerName, taxId: detail.customerTaxId },
    currency: detail.currency,
    lodgingAmount: detail.lodgingAmount,
    otaCommissionAmount: detail.otaCommissionAmount,
    netIncome: detail.netIncome,
    vatRateApplied: detail.vatRateApplied,
    vatAmount: detail.vatAmount,
    totalAmount: detail.totalAmount,
  };
}

function toSummaryResponseDto(summary: InvoiceChannelSummary): InvoiceSummaryResponseDto {
  return {
    range: { issuedFrom: summary.range.issuedFrom, issuedTo: summary.range.issuedTo },
    timezone: summary.timezone,
    currency: summary.currency,
    channels: summary.channels.map((channel) => ({
      channel: channel.channel,
      otaId: channel.otaId,
      invoiceCount: channel.invoiceCount,
      totalLodging: channel.totalLodging,
      totalOtaCommission: channel.totalOtaCommission,
      totalVat: channel.totalVat,
      totalInvoiced: channel.totalInvoiced,
    })),
  };
}
