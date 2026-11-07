// Feature 002 · Consultar liquidación
// T005 (HU1): la OTA consulta las liquidaciones Final de su reserva.
import { GetSettlementService } from '../../../../src/application/services/settlement/get-settlement.service';
import { InvalidSettlementQueryError } from '../../../../src/domain/errors/settlement/invalid-settlement-query.error';
import { SettlementNotFoundError } from '../../../../src/domain/errors/settlement/settlement-not-found.error';
import { SettlementCaller } from '../../../../src/domain/model/settlement/settlement-query';
import {
  GetSettlementResult,
  SettlementQueryResult,
} from '../../../../src/domain/model/settlement/settlement-query-result';
import {
  FakeReservationClient,
  InMemoryLodgingQuotes,
  InMemorySettlementRepository,
  RESERVATION_REF,
  ROOM_A,
  ROOM_B,
} from '../../../support/settlement/fake-settlement-ports';
import {
  directFinalSettlement,
  finalSettlement,
  InMemorySettlementInvoices,
  InMemorySettlementQuery,
  OTA_ID,
} from '../../../support/settlement/fake-settlement-query-ports';

const OTA: SettlementCaller = { kind: 'OTA', otaId: OTA_ID };
const ROOM_C = '7b2a0c69-3d4e-4f5a-9b8c-9d0e1f2a3b45';

function collectionOf(result: GetSettlementResult): readonly SettlementQueryResult[] {
  if (result.kind !== 'COLLECTION') throw new Error('Se esperaba la colección de la OTA');
  return result.settlements;
}

async function notFoundError(run: () => Promise<unknown>): Promise<SettlementNotFoundError> {
  try {
    await run();
  } catch (error) {
    if (error instanceof SettlementNotFoundError) return error;
    throw error;
  }
  throw new Error('Se esperaba SettlementNotFoundError');
}

describe('GetSettlementService — HU1: la OTA consulta su reserva', () => {
  let settlements: InMemorySettlementQuery;
  let invoices: InMemorySettlementInvoices;
  let service: GetSettlementService;

  beforeEach(() => {
    settlements = new InMemorySettlementQuery();
    invoices = new InMemorySettlementInvoices();
    service = new GetSettlementService(
      settlements,
      invoices,
      new InMemorySettlementRepository(),
      new FakeReservationClient(),
      new InMemoryLodgingQuotes(),
    );
  });

  it('devuelve las Final de la reserva con su desglose y la factura emitida (escenario 1, FR-002, FR-003)', async () => {
    const settlement = finalSettlement();
    settlements.settlements.push(settlement);
    const invoice = invoices.emit(settlement);

    const result = await service.execute({ reservationRef: RESERVATION_REF }, OTA);

    expect(result).toEqual({
      kind: 'COLLECTION',
      reservationRef: RESERVATION_REF,
      settlements: [
        {
          settlementType: 'FINAL',
          reservationRef: RESERVATION_REF,
          roomId: ROOM_A,
          categoryRoom: 'DOBLE',
          channel: 'OTA',
          otaId: OTA_ID,
          currency: 'COP',
          breakdown: {
            baseLodgingAmount: '700000.00',
            dynamicAdjustmentAmount: '50000.00',
            lodgingAmount: '750000.00',
            otaCommissionPercentage: '15.00',
            otaCommissionAmount: '112500.00',
            netIncome: '637500.00',
          },
          invoice,
          generatedAt: settlement.generatedAt,
        },
      ],
    });
    expect(settlements.calls).toEqual([{ reservationRef: RESERVATION_REF, otaId: OTA_ID }]);
  });

  it('una Final sin factura emitida todavía sale con invoice null, no se omite (FR-003)', async () => {
    settlements.settlements.push(finalSettlement());

    const [only] = collectionOf(await service.execute({ reservationRef: RESERVATION_REF }, OTA));

    expect(only.invoice).toBeNull();
    expect(only.settlementType).toBe('FINAL');
  });

  it('busca la factura de cada liquidación por su settlementId', async () => {
    const roomA = finalSettlement({ roomId: ROOM_A });
    const roomB = finalSettlement({ roomId: ROOM_B });
    settlements.settlements.push(roomA, roomB);
    invoices.emit(roomB, { invoiceNumber: 2001 });

    const found = collectionOf(await service.execute({ reservationRef: RESERVATION_REF }, OTA));

    expect(invoices.calls.sort()).toEqual([roomA.settlementId, roomB.settlementId].sort());
    expect(found.map((item) => item.invoice?.invoiceNumber ?? null)).toEqual([null, 2001]);
  });

  it('ordena la colección por roomId aunque el adaptador las entregue en otro orden (HU1)', async () => {
    settlements.settlements.push(
      finalSettlement({ roomId: ROOM_C }),
      finalSettlement({ roomId: ROOM_A }),
      finalSettlement({ roomId: ROOM_B }),
    );

    const found = collectionOf(await service.execute({ reservationRef: RESERVATION_REF }, OTA));

    expect(found.map((item) => item.roomId)).toEqual([ROOM_A, ROOM_B, ROOM_C]);
  });

  it('ordena por roomId sin distinguir mayúsculas y, en la misma habitación, por fecha de generación', async () => {
    const later = finalSettlement({
      roomId: ROOM_A,
      generatedAt: new Date('2026-12-28T10:00:00.000Z'),
    });
    const earlier = finalSettlement({
      roomId: ROOM_A,
      generatedAt: new Date('2026-12-23T10:00:00.000Z'),
    });
    const upperB = finalSettlement({ roomId: ROOM_B.toUpperCase() });
    settlements.settlements.push(upperB, later, earlier);

    const found = collectionOf(await service.execute({ reservationRef: RESERVATION_REF }, OTA));

    expect(found.map((item) => [item.roomId, item.generatedAt])).toEqual([
      [ROOM_A, earlier.generatedAt],
      [ROOM_A, later.generatedAt],
      [ROOM_B.toUpperCase(), upperB.generatedAt],
    ]);
  });

  it('sin liquidaciones Final en la reserva → SETTLEMENT_NOT_FOUND, sin valores en cero (escenario 2, FR-005, BR-004)', async () => {
    const error = await notFoundError(() =>
      service.execute({ reservationRef: RESERVATION_REF }, OTA),
    );

    expect(error.errorCode).toBe('SETTLEMENT_NOT_FOUND');
    expect(invoices.calls).toEqual([]);
  });

  it('una reserva directa o de otra OTA responde igual que una sin liquidaciones (escenario 3, FR-006)', async () => {
    const empty = await notFoundError(() => service.execute({ reservationRef: 'RES-VACIA' }, OTA));

    settlements.settlements.push(directFinalSettlement({ reservationRef: 'RES-DIRECTA' }));
    const direct = await notFoundError(() =>
      service.execute({ reservationRef: 'RES-DIRECTA' }, OTA),
    );

    settlements.settlements.push(
      finalSettlement({ reservationRef: 'RES-EXPEDIA', otaId: 'expedia' }),
    );
    const foreign = await notFoundError(() =>
      service.execute({ reservationRef: 'RES-EXPEDIA' }, OTA),
    );

    expect(direct.message).toBe(empty.message);
    expect(foreign.message).toBe(empty.message);
    expect(empty.message).not.toContain('RES-');
  });

  it('aunque el adaptador no filtre por OTA, nunca devuelve liquidaciones directas ni de otra OTA (NFR-003, SC-002)', async () => {
    settlements.leaky = true;
    const own = finalSettlement({ roomId: ROOM_A });
    settlements.settlements.push(
      own,
      directFinalSettlement({ roomId: ROOM_B }),
      finalSettlement({ roomId: ROOM_C, otaId: 'expedia' }),
    );

    const found = collectionOf(await service.execute({ reservationRef: RESERVATION_REF }, OTA));

    expect(found.map((item) => item.roomId)).toEqual([ROOM_A]);
    expect(invoices.calls).toEqual([own.settlementId]);
  });

  it('si el adaptador solo trae liquidaciones ajenas → SETTLEMENT_NOT_FOUND', async () => {
    settlements.leaky = true;
    settlements.settlements.push(finalSettlement({ otaId: 'expedia' }));

    await expect(service.execute({ reservationRef: RESERVATION_REF }, OTA)).rejects.toThrow(
      SettlementNotFoundError,
    );
  });

  it('ignora roomId en la consulta de la OTA: devuelve todas las habitaciones con check-out (contrato, «Parámetros»)', async () => {
    settlements.settlements.push(
      finalSettlement({ roomId: ROOM_A }),
      finalSettlement({ roomId: ROOM_B }),
    );

    const found = collectionOf(
      await service.execute({ reservationRef: RESERVATION_REF, roomId: ROOM_A }, OTA),
    );

    expect(found).toHaveLength(2);
  });

  it('consultas repetidas sin cambios devuelven exactamente el mismo resultado (FR-008, SC-005)', async () => {
    const settlement = finalSettlement();
    settlements.settlements.push(settlement, finalSettlement({ roomId: ROOM_B }));
    invoices.emit(settlement);

    const first = await service.execute({ reservationRef: RESERVATION_REF }, OTA);
    const second = await service.execute({ reservationRef: RESERVATION_REF }, OTA);

    expect(second).toEqual(first);
  });

  it('sin reservationRef → INVALID_QUERY_PARAMS sin consultar ninguna liquidación (FR-013)', async () => {
    await expect(service.execute({}, OTA)).rejects.toThrow(InvalidSettlementQueryError);
    expect(settlements.calls).toEqual([]);
  });

  it('si falla la lectura de liquidaciones o de facturas, el error se propaga sin resultado parcial', async () => {
    settlements.failure = new Error('base de datos caída');
    await expect(service.execute({ reservationRef: RESERVATION_REF }, OTA)).rejects.toThrow(
      'base de datos caída',
    );

    settlements.failure = undefined;
    settlements.settlements.push(finalSettlement());
    invoices.failure = new Error('lectura de factura fallida');
    await expect(service.execute({ reservationRef: RESERVATION_REF }, OTA)).rejects.toThrow(
      'lectura de factura fallida',
    );
  });
});
