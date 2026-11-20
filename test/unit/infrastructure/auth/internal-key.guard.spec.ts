// Seguridad entre módulos · X-Internal-Key
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Module1InternalKeyGuard,
  Module2InternalKeyGuard,
} from '../../../../src/infrastructure/adapters/in/http/auth/internal-key.guard';

function configWith(values: Record<string, string>): ConfigService {
  return { get: (name: string) => values[name] } as unknown as ConfigService;
}

function contextWith(headers: Record<string, string>): ExecutionContext {
  const request = { headers };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('InternalKeyGuard', () => {
  it('sin clave configurada no la exige: deja pasar la llamada interna sin cabecera', () => {
    const guard = new Module1InternalKeyGuard(configWith({}));
    expect(guard.canActivate(contextWith({}))).toBe(true);
  });

  it('una clave de solo espacios cuenta como no configurada', () => {
    const guard = new Module2InternalKeyGuard(configWith({ INBOUND_KEY_MODULE2: '   ' }));
    expect(guard.canActivate(contextWith({}))).toBe(true);
  });

  describe('con la clave de Módulo 1 configurada', () => {
    const guard = new Module1InternalKeyGuard(configWith({ INBOUND_KEY_MODULE1: 'clave-m1' }));

    it('deja pasar la llamada interna con la clave correcta', () => {
      expect(guard.canActivate(contextWith({ 'x-internal-key': 'clave-m1' }))).toBe(true);
    });

    it('rechaza con 401 la llamada interna sin cabecera', () => {
      expect(() => guard.canActivate(contextWith({}))).toThrow(UnauthorizedException);
    });

    it('rechaza con 401 una clave distinta, aunque tenga otro largo', () => {
      expect(() => guard.canActivate(contextWith({ 'x-internal-key': 'otra' }))).toThrow(
        UnauthorizedException,
      );
    });

    it('no acepta la clave de otro módulo', () => {
      const m2 = new Module2InternalKeyGuard(configWith({ INBOUND_KEY_MODULE2: 'clave-m2' }));
      expect(() => m2.canActivate(contextWith({ 'x-internal-key': 'clave-m1' }))).toThrow(
        UnauthorizedException,
      );
    });

    it('con Authorization no revisa la clave: la OTA ya la validaron los otros guards', () => {
      expect(guard.canActivate(contextWith({ authorization: 'Bearer ok' }))).toBe(true);
    });
  });
});
