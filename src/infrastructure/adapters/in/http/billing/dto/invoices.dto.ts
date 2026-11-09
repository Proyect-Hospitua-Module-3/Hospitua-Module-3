// Feature 008 · Gestionar facturación
// Forma pública: contratos GET-invoices.md, GET-invoices-id.md y GET-invoices-summary.md.
// Estas clases solo documentan la API en Swagger: los parámetros llegan tal cual y los valida
// el caso de uso (pueden faltar, repetirse o venir vacíos).
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SearchInvoicesQueryDto {
  @ApiPropertyOptional({
    example: 'c3a9e1b2-5f4d-4e6a-8b7c-1d2e3f4a5b6c',
    description: 'Criterio: estancia (UUID)',
  })
  stayId?: string;

  @ApiPropertyOptional({ example: 'RES-000123', description: 'Criterio: referencia de la reserva' })
  reservationRef?: string;

  @ApiPropertyOptional({
    example: 'Comercializadora Andina',
    description: 'Criterio: nombre o razón social del cliente',
  })
  customerName?: string;

  @ApiPropertyOptional({
    enum: ['EXACT', 'PARTIAL'],
    description:
      'Coincidencia del nombre. EXACT (por defecto): nombre completo sin distinguir mayúsculas. PARTIAL: texto dentro del nombre, mínimo 3 caracteres',
  })
  customerMatch?: 'EXACT' | 'PARTIAL';

  @ApiPropertyOptional({
    example: '900123456-7',
    description: 'Criterio: documento fiscal del cliente (coincidencia exacta)',
  })
  customerTaxId?: string;

  @ApiPropertyOptional({ enum: ['DIRECT', 'OTA'], description: 'Criterio: canal de origen' })
  channel?: 'DIRECT' | 'OTA';

  @ApiPropertyOptional({ example: 'booking', description: 'OTA específica; solo con channel=OTA' })
  otaId?: string;

  @ApiPropertyOptional({
    example: '2026-12-01',
    description: 'Criterio (junto con issuedTo): inicio del rango de emisión, hora de Bogotá',
  })
  issuedFrom?: string;

  @ApiPropertyOptional({
    example: '2026-12-31',
    description: 'Criterio (junto con issuedFrom): fin del rango de emisión, inclusive',
  })
  issuedTo?: string;

  @ApiPropertyOptional({ example: 1, description: 'Página, desde 1. Por defecto 1' })
  page?: string;

  @ApiPropertyOptional({ example: 20, description: 'Facturas por página, 1–100. Por defecto 20' })
  pageSize?: string;

  @ApiPropertyOptional({
    example: '2026-12-31T23:20:00.000Z',
    description:
      'Foto de la búsqueda: no se envía en la primera página; en las siguientes se reenvía el asOf recibido',
  })
  asOf?: string;
}

export class InvoiceSummaryQueryDto {
  @ApiProperty({
    example: '2026-12-01',
    description: 'Inicio del rango de emisión, hora de Bogotá',
  })
  issuedFrom: string;

  @ApiProperty({ example: '2026-12-31', description: 'Fin del rango de emisión, inclusive' })
  issuedTo: string;
}

export class InvoiceSearchItemDto {
  @ApiProperty({ example: '7d1c2f0e-4b8a-4c51-9a3e-2f6b1d9c8e01' })
  invoiceId: string;

  @ApiProperty({ example: 1042, description: 'Consecutivo oficial de la factura' })
  invoiceNumber: number;

  @ApiProperty({ example: '2026-12-23T16:05:12.000Z' })
  issuedAt: string;

  @ApiProperty({ example: 'c3a9e1b2-5f4d-4e6a-8b7c-1d2e3f4a5b6c' })
  stayId: string;

  @ApiProperty({ example: 'RES-000123' })
  reservationRef: string;

  @ApiProperty({ enum: ['DIRECT', 'OTA'], example: 'OTA' })
  channel: 'DIRECT' | 'OTA';

  @ApiProperty({ example: 'booking', nullable: true, type: String })
  otaId: string | null;

  @ApiProperty({ example: 'Comercializadora Andina S.A.S.' })
  customerName: string;

  @ApiProperty({ example: '900123456-7' })
  customerTaxId: string;

  @ApiProperty({ example: 'COP' })
  currency: string;

  @ApiProperty({ example: '892500.00', description: 'Total facturado (con IVA)' })
  totalAmount: string;
}

export class InvoiceSearchResponseDto {
  @ApiProperty({ type: [InvoiceSearchItemDto] })
  items: InvoiceSearchItemDto[];

  @ApiProperty({ example: 1 })
  page: number;

  @ApiProperty({ example: 20 })
  pageSize: number;

  @ApiProperty({ example: 1, description: 'Coincidencias en todas las páginas' })
  totalItems: number;

  @ApiProperty({ example: 1 })
  totalPages: number;

  @ApiProperty({
    example: '2026-12-31T23:20:00.000Z',
    description: 'Foto usada; reenvíala para pedir otras páginas',
  })
  asOf: string;

  @ApiProperty({ enum: ['MATCHES', 'NO_MATCHES'], example: 'MATCHES' })
  resultStatus: 'MATCHES' | 'NO_MATCHES';

  @ApiProperty({
    enum: ['EXACT', 'PARTIAL'],
    nullable: true,
    example: null,
    description: 'Modo aplicado al nombre; null si no se buscó por nombre',
  })
  customerMatchMode: 'EXACT' | 'PARTIAL' | null;
}

export class InvoiceCustomerDto {
  @ApiProperty({ example: 'Comercializadora Andina S.A.S.' })
  name: string;

  @ApiProperty({ example: '900123456-7' })
  taxId: string;
}

export class InvoiceDetailDto {
  @ApiProperty({ example: '7d1c2f0e-4b8a-4c51-9a3e-2f6b1d9c8e01' })
  invoiceId: string;

  @ApiProperty({ example: 1042 })
  invoiceNumber: number;

  @ApiProperty({ example: 'ISSUED' })
  status: string;

  @ApiProperty({ example: true, description: 'Siempre true: la factura no se puede modificar' })
  immutable: boolean;

  @ApiProperty({ example: '2026-12-23T16:05:12.000Z' })
  issuedAt: string;

  @ApiProperty({
    example: '4e2b8c1d-9a7f-4f3e-b6d5-0c1a2b3d4e5f',
    description: 'Liquidación de origen',
  })
  settlementId: string;

  @ApiProperty({ example: 'c3a9e1b2-5f4d-4e6a-8b7c-1d2e3f4a5b6c' })
  stayId: string;

  @ApiProperty({ example: 'RES-000123' })
  reservationRef: string;

  @ApiProperty({ enum: ['DIRECT', 'OTA'], example: 'OTA' })
  channel: 'DIRECT' | 'OTA';

  @ApiProperty({ example: 'booking', nullable: true, type: String })
  otaId: string | null;

  @ApiProperty({ type: InvoiceCustomerDto })
  customer: InvoiceCustomerDto;

  @ApiProperty({ example: 'COP' })
  currency: string;

  @ApiProperty({ example: '750000.00', description: 'Hospedaje (base gravable)' })
  lodgingAmount: string;

  @ApiProperty({ example: '112500.00', description: 'Comisión OTA informativa; "0.00" en directo' })
  otaCommissionAmount: string;

  @ApiProperty({ example: '637500.00', description: 'Hospedaje menos comisión' })
  netIncome: string;

  @ApiProperty({ example: '19.00' })
  vatRateApplied: string;

  @ApiProperty({ example: '142500.00' })
  vatAmount: string;

  @ApiProperty({ example: '892500.00', description: 'Hospedaje + IVA' })
  totalAmount: string;
}

export class InvoiceSummaryRangeDto {
  @ApiProperty({ example: '2026-12-01' })
  issuedFrom: string;

  @ApiProperty({ example: '2026-12-31' })
  issuedTo: string;
}

export class ChannelTotalsDto {
  @ApiProperty({ enum: ['DIRECT', 'OTA'], example: 'OTA' })
  channel: 'DIRECT' | 'OTA';

  @ApiProperty({ example: 'booking', nullable: true, type: String })
  otaId: string | null;

  @ApiProperty({ example: 6 })
  invoiceCount: number;

  @ApiProperty({ example: '4500000.00' })
  totalLodging: string;

  @ApiProperty({ example: '675000.00', description: 'Siempre "0.00" en el canal directo' })
  totalOtaCommission: string;

  @ApiProperty({ example: '855000.00' })
  totalVat: string;

  @ApiProperty({ example: '5355000.00', description: 'Total facturado (con IVA)' })
  totalInvoiced: string;
}

export class InvoiceSummaryResponseDto {
  @ApiProperty({ type: InvoiceSummaryRangeDto })
  range: InvoiceSummaryRangeDto;

  @ApiProperty({ example: 'America/Bogota' })
  timezone: string;

  @ApiProperty({ example: 'COP' })
  currency: string;

  @ApiProperty({
    type: [ChannelTotalsDto],
    description: 'Primero DIRECT y después cada OTA por otaId; los canales sin facturas en cero',
  })
  channels: ChannelTotalsDto[];
}
