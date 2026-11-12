// Feature 003 · Consultar porcentaje de comisión OTA (T020)
import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { OtaCommissionAccessGuard } from '../../../../src/infrastructure/adapters/in/http/ota-commission/ota-commission-access.guard';

function contextWith(authorization: string | undefined, user?: unknown): ExecutionContext {
  const request = { headers: authorization ? { authorization } : {}, user };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('OtaCommissionAccessGuard (003)', () => {
  const guard = new OtaCommissionAccessGuard();

  it('sin token deja pasar: es una llamada interna de Módulo 2', () => {
    expect(guard.canActivate(contextWith(undefined))).toBe(true);
  });

  it('con token OTA y otaId deja pasar', () => {
    expect(guard.canActivate(contextWith('Bearer x', { role: 'OTA', otaId: 'booking' }))).toBe(
      true,
    );
  });

  it('con token de Administrador → 403', () => {
    expect(() =>
      guard.canActivate(contextWith('Bearer x', { role: 'Administrador', sub: 'admin' })),
    ).toThrow(ForbiddenException);
  });

  it.each([undefined, '', '  '])('con token OTA sin otaId (%p) → 401', (otaId) => {
    expect(() => guard.canActivate(contextWith('Bearer x', { role: 'OTA', otaId }))).toThrow(
      UnauthorizedException,
    );
  });
});
