// Feature 002 · Consultar liquidación (T003)
import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { AuthenticatedUser } from '../../../../src/infrastructure/adapters/in/http/auth/authenticated-user';
import { SettlementAccessGuard } from '../../../../src/infrastructure/adapters/in/http/settlement/settlement-access.guard';

// OptionalJwtAuthGuard corre antes: si hay cabecera Authorization, request.user ya es el
// usuario del token válido.
function contextWith(
  authorization: string | undefined,
  user?: AuthenticatedUser,
): ExecutionContext {
  const request = { headers: authorization === undefined ? {} : { authorization }, user };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('SettlementAccessGuard', () => {
  const guard = new SettlementAccessGuard();

  it('deja pasar sin cabecera Authorization: es la llamada interna de Módulo 1 (FR-013)', () => {
    expect(guard.canActivate(contextWith(undefined))).toBe(true);
  });

  it('deja pasar un token OTA con otaId (FR-006)', () => {
    expect(
      guard.canActivate(contextWith('Bearer ok', { sub: 'u1', role: 'OTA', otaId: 'booking' })),
    ).toBe(true);
  });

  it('rechaza con 403 un token de otro rol (BR-006)', () => {
    const run = () =>
      guard.canActivate(contextWith('Bearer ok', { sub: 'admin', role: 'Administrador' }));

    expect(run).toThrow(ForbiddenException);
    expect(run).toThrow('Tu rol no tiene permiso para consultar liquidaciones.');
  });

  it.each([
    ['sin otaId', undefined],
    ['con otaId vacío', ''],
    ['con otaId en blanco', '   '],
  ])('rechaza con 401 un token OTA %s (contrato, «Errores»)', (_case, otaId) => {
    const run = () =>
      guard.canActivate(contextWith('Bearer ok', { sub: 'u1', role: 'OTA', otaId }));

    expect(run).toThrow(UnauthorizedException);
    expect(run).toThrow('otaId');
  });

  it('con cabecera pero sin usuario no deja pasar: nunca trata la petición como de Módulo 1', () => {
    expect(() => guard.canActivate(contextWith('Bearer x'))).toThrow(ForbiddenException);
  });
});
