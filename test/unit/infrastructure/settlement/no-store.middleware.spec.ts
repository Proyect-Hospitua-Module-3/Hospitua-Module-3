// Feature 002 · Consultar liquidación (T001)
import { Request, Response } from 'express';
import { NoStoreMiddleware } from '../../../../src/infrastructure/adapters/in/http/settlement/no-store.middleware';

describe('NoStoreMiddleware', () => {
  it('pone Cache-Control: no-store y continúa con la petición', () => {
    const setHeader = jest.fn();
    const next = jest.fn();

    new NoStoreMiddleware().use({} as Request, { setHeader } as unknown as Response, next);

    expect(setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(next).toHaveBeenCalledTimes(1);
  });
});
