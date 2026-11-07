import { describe, expect, it, vi } from 'vitest';
import { apiRequest, ApiError, NETWORK_ERROR } from './http';

function respond(status: number, body: unknown) {
  return vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(new Response(JSON.stringify(body), { status }));
}

describe('apiRequest', () => {
  it('llama a /api con el token y el cuerpo en JSON', async () => {
    const fetchSpy = respond(200, { value: '19.00' });

    await expect(
      apiRequest('/admin/vat-rate', { method: 'PUT', token: 'abc', body: { value: '19' } }),
    ).resolves.toEqual({ value: '19.00' });

    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('/api/admin/vat-rate');
    expect(init?.method).toBe('PUT');
    expect(init?.body).toBe('{"value":"19"}');
    expect(init?.headers).toMatchObject({
      Authorization: 'Bearer abc',
      'Content-Type': 'application/json',
    });
  });

  it('traduce un ApiError del backend con su código y mensaje', async () => {
    respond(400, {
      errorCode: 'INVALID_VAT_RATE',
      message: 'fuera de rango',
      path: '/admin/vat-rate',
    });

    await expect(apiRequest('/admin/vat-rate')).rejects.toMatchObject({
      status: 400,
      errorCode: 'INVALID_VAT_RATE',
      message: 'fuera de rango',
    });
  });

  it('un 4xx sin formato ApiError es UNEXPECTED_ERROR', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('<html>', { status: 404 }));

    await expect(apiRequest('/admin/vat-rate')).rejects.toMatchObject({
      status: 404,
      errorCode: 'UNEXPECTED_ERROR',
    });
  });

  it('un 5xx sin ApiError (proxy de Vite sin backend) dice que el backend está apagado', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 500 }));

    await expect(apiRequest('/auth/login')).rejects.toMatchObject({
      status: 0,
      errorCode: NETWORK_ERROR,
      message: expect.stringContaining('backend esté encendido'),
    });
  });

  it('sin conexión lanza NETWORK_ERROR con status 0', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));

    const error = await apiRequest('/admin/vat-rate').catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 0, errorCode: NETWORK_ERROR });
  });
});
