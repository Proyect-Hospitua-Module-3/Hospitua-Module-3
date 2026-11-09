// Feature 008 · Gestionar facturación
// Zona horaria de referencia de los filtros por fecha y del resumen (NFR-006).
import {
  isValidTimeZone,
  issuedIntervalOf,
} from '../../../../src/domain/model/billing/issued-date-range';

describe('issuedIntervalOf — rango de emisión en la zona de referencia (NFR-006)', () => {
  it('en Bogotá (UTC−5) el día va de las 05:00 UTC a las 05:00 UTC del día siguiente', () => {
    expect(
      issuedIntervalOf({ issuedFrom: '2026-12-01', issuedTo: '2026-12-31' }, 'America/Bogota'),
    ).toEqual({
      from: new Date('2026-12-01T05:00:00.000Z'),
      before: new Date('2027-01-01T05:00:00.000Z'),
    });
  });

  it('un solo día cubre exactamente 24 horas', () => {
    const { from, before } = issuedIntervalOf(
      { issuedFrom: '2026-12-23', issuedTo: '2026-12-23' },
      'America/Bogota',
    );
    expect(before.getTime() - from.getTime()).toBe(24 * 60 * 60 * 1000);
  });

  it('cruza el fin de mes y de año bisiesto', () => {
    expect(
      issuedIntervalOf({ issuedFrom: '2028-02-28', issuedTo: '2028-02-29' }, 'America/Bogota')
        .before,
    ).toEqual(new Date('2028-03-01T05:00:00.000Z'));
  });

  it('las 23:59 de Bogotá quedan en ese día aunque en UTC ya sea el siguiente', () => {
    const { from, before } = issuedIntervalOf(
      { issuedFrom: '2026-12-23', issuedTo: '2026-12-23' },
      'America/Bogota',
    );
    const lateNight = new Date('2026-12-24T04:59:00.000Z'); // 23:59 del 23 en Bogotá
    const nextMidnight = new Date('2026-12-24T05:00:00.000Z'); // 00:00 del 24 en Bogotá
    expect(lateNight >= from && lateNight < before).toBe(true);
    expect(nextMidnight < before).toBe(false);
  });

  it('funciona con otra zona, también con cambio de horario', () => {
    expect(issuedIntervalOf({ issuedFrom: '2026-07-01', issuedTo: '2026-07-01' }, 'UTC')).toEqual({
      from: new Date('2026-07-01T00:00:00.000Z'),
      before: new Date('2026-07-02T00:00:00.000Z'),
    });
    // Madrid: 29 de marzo de 2026 pasa de UTC+1 a UTC+2.
    expect(
      issuedIntervalOf({ issuedFrom: '2026-03-29', issuedTo: '2026-03-29' }, 'Europe/Madrid'),
    ).toEqual({
      from: new Date('2026-03-28T23:00:00.000Z'),
      before: new Date('2026-03-29T22:00:00.000Z'),
    });
  });
});

describe('isValidTimeZone', () => {
  it('reconoce zonas IANA y rechaza el resto', () => {
    expect(isValidTimeZone('America/Bogota')).toBe(true);
    expect(isValidTimeZone('UTC')).toBe(true);
    expect(isValidTimeZone('Bogota')).toBe(false);
    expect(isValidTimeZone('America/Medellin')).toBe(false);
  });
});
