// Feature 007 · Generar liquidación (T016)
// Contrato CLIENT-get-reservation.md: lo que settlement espera de
// GET /api/reservations/{reservationRef} de Módulo 2 y cómo interpreta cada respuesta.
import { ConfigService } from '@nestjs/config';
import { HttpModule } from '@nestjs/axios';
import { Test, TestingModule } from '@nestjs/testing';
import { ReservationNotFoundError } from '../../../src/domain/errors/settlement/reservation-not-found.error';
import { Module2ReservationClient } from '../../../src/infrastructure/adapters/out/http/module2-reservation.client';
import { Module1HttpFixture } from '../../support/pricing/module1-http-fixture';

const QUOTE_A = 'a1f2c3d4-e5b6-4789-8a9b-0c1d2e3f4a5b';
const QUOTE_B = 'b7c8d9e0-f1a2-4b3c-8d4e-5f6a7b8c9d0e';

// Ejemplos del contrato, sección 3.
const OTA_TWO_ROOMS = {
  reservationRef: 'RES-000123',
  quoteIds: [QUOTE_A, QUOTE_B],
  channel: 'OTA',
  otaId: 'booking',
  otaConfirmationCode: 'BKG-88421',
  otaCommissionPercentage: 15,
};
const DIRECT_WITHOUT_CHANNEL = {
  reservationRef: 'RES-000124',
  quoteIds: ['c9d0e1f2-a3b4-4c5d-8e6f-7a8b9c0d1e2f'],
};

describe('Contrato con Módulo 2: GET /api/reservations/{reservationRef}', () => {
  let fixture: Module1HttpFixture;
  let moduleRef: TestingModule;
  let client: Module2ReservationClient;

  beforeEach(async () => {
    fixture = new Module1HttpFixture();
    await fixture.start();
    moduleRef = await Test.createTestingModule({
      imports: [HttpModule.register({})],
      providers: [
        Module2ReservationClient,
        {
          provide: ConfigService,
          useValue: {
            get: (name: string) =>
              name === 'MODULE2_BASE_URL'
                ? fixture.baseUrl
                : name === 'MODULE2_TIMEOUT_MS'
                  ? '500'
                  : undefined,
          },
        },
      ],
    }).compile();
    client = moduleRef.get(Module2ReservationClient);
  });

  afterEach(async () => {
    await moduleRef?.close();
    await fixture.stop();
  });

  it('reserva OTA con dos habitaciones: quoteIds, canal, OTA, código y comisión', async () => {
    fixture.setReply({ status: 200, body: OTA_TWO_ROOMS });

    await expect(client.getReservation('RES-000123')).resolves.toEqual(OTA_TWO_ROOMS);
  });

  it('acepta el porcentaje como texto', async () => {
    fixture.setReply({ status: 200, body: { ...OTA_TWO_ROOMS, otaCommissionPercentage: '15.00' } });

    await expect(client.getReservation('RES-000123')).resolves.toMatchObject({
      otaCommissionPercentage: '15.00',
    });
  });

  it('reserva directa sin channel → channel null', async () => {
    fixture.setReply({ status: 200, body: DIRECT_WITHOUT_CHANNEL });

    await expect(client.getReservation('RES-000124')).resolves.toEqual({
      ...DIRECT_WITHOUT_CHANNEL,
      channel: null,
    });
  });

  it('canal distinto de OTA: se ignoran los campos de OTA que lleguen', async () => {
    fixture.setReply({
      status: 200,
      body: {
        ...DIRECT_WITHOUT_CHANNEL,
        channel: 'RECEPTION',
        otaId: 'booking',
        otaCommissionPercentage: 15,
      },
    });

    await expect(client.getReservation('RES-000124')).resolves.toEqual({
      ...DIRECT_WITHOUT_CHANNEL,
      channel: 'RECEPTION',
    });
  });

  it('ignora campos desconocidos, incluidos los datos del huésped (NFR-006)', async () => {
    fixture.setReply({
      status: 200,
      body: {
        ...DIRECT_WITHOUT_CHANNEL,
        guest: { name: 'Ana', documentId: '123' },
        status: 'CONFIRMED',
      },
    });

    const reservation = await client.getReservation('RES-000124');

    expect(Object.keys(reservation).sort()).toEqual(['channel', 'quoteIds', 'reservationRef']);
  });

  it.each([
    ['ausente', undefined],
    ['null', null],
  ])(
    'OTA con otaCommissionPercentage %s: el cliente lo deja pasar y el servicio responde MISSING_COMMISSION',
    async (_label, percentage) => {
      fixture.setReply({
        status: 200,
        body: { ...OTA_TWO_ROOMS, otaCommissionPercentage: percentage },
      });

      const reservation = await client.getReservation('RES-000123');

      expect(reservation.otaCommissionPercentage ?? null).toBeNull();
    },
  );

  it('quoteIds vacío es válido: el servicio responde QUOTE_NOT_FOUND', async () => {
    fixture.setReply({ status: 200, body: { ...DIRECT_WITHOUT_CHANNEL, quoteIds: [] } });

    await expect(client.getReservation('RES-000124')).resolves.toMatchObject({ quoteIds: [] });
  });

  it('404 → RESERVATION_NOT_FOUND', async () => {
    fixture.setReply({ status: 404 });

    await expect(client.getReservation('RES-000999')).rejects.toBeInstanceOf(
      ReservationNotFoundError,
    );
  });

  it.each([
    ['falta reservationRef', { quoteIds: [QUOTE_A] }],
    ['reservationRef de otra reserva', { reservationRef: 'RES-000999', quoteIds: [QUOTE_A] }],
    ['falta quoteIds', { reservationRef: 'RES-000123' }],
    ['quoteIds no es una lista', { reservationRef: 'RES-000123', quoteIds: QUOTE_A }],
    ['un quoteId no es UUID', { reservationRef: 'RES-000123', quoteIds: ['cotizacion-1'] }],
    ['channel no es texto', { reservationRef: 'RES-000123', quoteIds: [QUOTE_A], channel: 1 }],
    ['OTA sin otaId', { ...OTA_TWO_ROOMS, otaId: undefined }],
    ['OTA sin otaConfirmationCode', { ...OTA_TWO_ROOMS, otaConfirmationCode: '' }],
    ['porcentaje de otro tipo', { ...OTA_TWO_ROOMS, otaCommissionPercentage: true }],
    ['una lista en lugar de un objeto', [OTA_TWO_ROOMS]],
  ])('cuerpo malformado (%s) → MODULE2_UNAVAILABLE', async (_label, body) => {
    fixture.setReply({ status: 200, body });

    await expect(client.getReservation('RES-000123')).rejects.toMatchObject({
      errorCode: 'MODULE2_UNAVAILABLE',
    });
  });
});
