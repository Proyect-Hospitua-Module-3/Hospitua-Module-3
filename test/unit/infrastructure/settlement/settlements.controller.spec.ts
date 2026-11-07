// Feature 002 · Consultar liquidación (T004)
// El controller todavía no está registrado en SettlementModule (se registra con el servicio
// en T011): aquí se prueba solo, con un caso de uso falso.
import { ArgumentsHost } from '@nestjs/common';
import { Request } from 'express';
import { SettlementNotFoundError } from '../../../../src/domain/errors/settlement/settlement-not-found.error';
import {
  SettlementCaller,
  SettlementQuery,
} from '../../../../src/domain/model/settlement/settlement-query';
import {
  GetSettlementResult,
  SettlementQueryResult,
} from '../../../../src/domain/model/settlement/settlement-query-result';
import { GetSettlementUseCase } from '../../../../src/domain/ports/in/settlement/get-settlement.use-case';
import { DomainExceptionFilter } from '../../../../src/infrastructure/adapters/in/http/domain-exception.filter';
import { SettlementQueryDto } from '../../../../src/infrastructure/adapters/in/http/settlement/dto/settlement.dto';
import { SettlementsController } from '../../../../src/infrastructure/adapters/in/http/settlement/settlements.controller';

const ROOM_A = '1a2b3c4d-0000-4000-8000-00000000000a';
const ROOM_B = '1a2b3c4d-0000-4000-8000-00000000000b';

function finalOf(roomId: string, withInvoice: boolean): SettlementQueryResult {
  return {
    settlementType: 'FINAL',
    reservationRef: 'RES-000123',
    roomId,
    categoryRoom: 'DOBLE',
    channel: 'OTA',
    otaId: 'booking',
    currency: 'COP',
    breakdown: {
      baseLodgingAmount: '700000.00',
      dynamicAdjustmentAmount: '50000.00',
      lodgingAmount: '750000.00',
      otaCommissionPercentage: '15.00',
      otaCommissionAmount: '112500.00',
      netIncome: '637500.00',
    },
    invoice: withInvoice
      ? {
          invoiceId: '7d1c2f0e-4b8a-4c51-9a3e-2f6b1d9c8e01',
          invoiceNumber: 1042,
          issuedAt: new Date('2026-10-08T16:05:12.000Z'),
          vatRateApplied: '19.00',
          vatAmount: '142500.00',
          totalAmount: '892500.00',
          status: 'ISSUED',
        }
      : null,
    generatedAt: new Date('2026-10-08T16:02:00.000Z'),
  };
}

class FakeGetSettlement implements GetSettlementUseCase {
  calls: { query: SettlementQuery; caller: SettlementCaller }[] = [];

  constructor(private readonly result: GetSettlementResult) {}

  execute(query: SettlementQuery, caller: SettlementCaller): Promise<GetSettlementResult> {
    this.calls.push({ query, caller });
    return Promise.resolve(this.result);
  }
}

function requestWith(user?: object): Request {
  return { headers: { 'x-correlation-id': 'corr-123' }, user } as unknown as Request;
}

describe('SettlementsController', () => {
  it('Módulo 1 (sin usuario): llama como INTERNAL con los parámetros tal cual y el id de correlación', async () => {
    const useCase = new FakeGetSettlement({ kind: 'SINGLE', settlement: finalOf(ROOM_A, false) });
    const query = {
      reservationRef: 'RES-000123',
      roomId: ROOM_A,
      categoryRoom: 'SUITE',
    } as SettlementQueryDto;

    await new SettlementsController(useCase).get(query, requestWith());

    expect(useCase.calls).toEqual([
      {
        query: { reservationRef: 'RES-000123', roomId: ROOM_A, correlationId: 'corr-123' },
        caller: { kind: 'INTERNAL' },
      },
    ]);
  });

  it('OTA (con usuario): llama como OTA con el otaId del token', async () => {
    const useCase = new FakeGetSettlement({
      kind: 'COLLECTION',
      reservationRef: 'RES-000123',
      settlements: [],
    });

    await new SettlementsController(useCase).get(
      { reservationRef: 'RES-000123' } as SettlementQueryDto,
      requestWith({ sub: 'u1', role: 'OTA', otaId: 'booking' }),
    );

    expect(useCase.calls[0].caller).toEqual({ kind: 'OTA', otaId: 'booking' });
  });

  it('proyecta un resultado individual al objeto de liquidación del contrato, con fechas ISO', async () => {
    const useCase = new FakeGetSettlement({ kind: 'SINGLE', settlement: finalOf(ROOM_A, true) });

    const body = await new SettlementsController(useCase).get(
      { reservationRef: 'RES-000123', roomId: ROOM_A } as SettlementQueryDto,
      requestWith(),
    );

    expect(body).toEqual({
      settlementType: 'FINAL',
      reservationRef: 'RES-000123',
      roomId: ROOM_A,
      categoryRoom: 'DOBLE',
      channel: 'OTA',
      otaId: 'booking',
      currency: 'COP',
      breakdown: {
        baseLodgingAmount: '700000.00',
        dynamicAdjustmentAmount: '50000.00',
        lodgingAmount: '750000.00',
        otaCommissionPercentage: '15.00',
        otaCommissionAmount: '112500.00',
        netIncome: '637500.00',
      },
      invoice: {
        invoiceId: '7d1c2f0e-4b8a-4c51-9a3e-2f6b1d9c8e01',
        invoiceNumber: 1042,
        issuedAt: '2026-10-08T16:05:12.000Z',
        vatRateApplied: '19.00',
        vatAmount: '142500.00',
        totalAmount: '892500.00',
        status: 'ISSUED',
      },
      generatedAt: '2026-10-08T16:02:00.000Z',
    });
  });

  it('proyecta la colección de la OTA en el orden que entrega el caso de uso, con invoice null si no hay factura', async () => {
    const useCase = new FakeGetSettlement({
      kind: 'COLLECTION',
      reservationRef: 'RES-000123',
      settlements: [finalOf(ROOM_A, true), finalOf(ROOM_B, false)],
    });

    const body = await new SettlementsController(useCase).get(
      { reservationRef: 'RES-000123' } as SettlementQueryDto,
      requestWith({ sub: 'u1', role: 'OTA', otaId: 'booking' }),
    );

    expect(body).toMatchObject({
      reservationRef: 'RES-000123',
      settlements: [
        { roomId: ROOM_A, invoice: { invoiceNumber: 1042 } },
        { roomId: ROOM_B, invoice: null },
      ],
    });
  });
});

describe('DomainExceptionFilter con los errores de 002', () => {
  it('SETTLEMENT_NOT_FOUND sale como 404 con la estructura ApiError', () => {
    const json = jest.fn();
    const status = jest.fn(() => ({ json }));
    const host = {
      switchToHttp: () => ({
        getRequest: () => ({ headers: {}, originalUrl: '/api/settlements?reservationRef=RES-1' }),
        getResponse: () => ({ status }),
      }),
    } as unknown as ArgumentsHost;

    new DomainExceptionFilter().catch(new SettlementNotFoundError(), host);

    expect(status).toHaveBeenCalledWith(404);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        errorCode: 'SETTLEMENT_NOT_FOUND',
        path: '/api/settlements?reservationRef=RES-1',
      }),
    );
  });
});
