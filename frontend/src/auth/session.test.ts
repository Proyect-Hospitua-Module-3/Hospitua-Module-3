import { describe, expect, it } from 'vitest';
import { isExpired, loadSession, saveSession, sessionFromToken } from './session';

function fakeJwt(claims: Record<string, unknown>): string {
  const encode = (value: unknown) =>
    btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${encode({ alg: 'HS256' })}.${encode(claims)}.firma`;
}

describe('session', () => {
  it('lee sub, role y exp del token', () => {
    const token = fakeJwt({ sub: 'u-1', role: 'Administrador', exp: 2_000_000_000 });

    expect(sessionFromToken(token, 'admin', 3600)).toEqual({
      token,
      username: 'admin',
      userId: 'u-1',
      role: 'Administrador',
      expiresAt: 2_000_000_000_000,
    });
  });

  it('sin exp en el token usa expiresIn', () => {
    const session = sessionFromToken(fakeJwt({ sub: 'u-1', role: 'OTA' }), 'ota', 60);

    expect(session.expiresAt).toBeGreaterThan(Date.now());
    expect(isExpired(session, session.expiresAt)).toBe(true);
  });

  it('un token ilegible no rompe: claims vacíos', () => {
    expect(sessionFromToken('no-es-un-jwt', 'admin', 60)).toMatchObject({ userId: '', role: '' });
  });

  it('guarda y recupera la sesión; una vencida no se recupera', () => {
    const valid = sessionFromToken(
      fakeJwt({ sub: 'u', role: 'Administrador', exp: 4_000_000_000 }),
      'admin',
      0,
    );
    saveSession(valid);
    expect(loadSession()).toEqual(valid);

    saveSession({ ...valid, expiresAt: Date.now() - 1 });
    expect(loadSession()).toBeNull();

    saveSession(null);
    expect(loadSession()).toBeNull();
  });
});
