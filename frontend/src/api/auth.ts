import { apiRequest } from './http';

export interface LoginResponse {
  accessToken: string;
  expiresIn: number;
}

// POST /auth/login: login propio de Módulo 3 (plan base).
export function login(username: string, password: string): Promise<LoginResponse> {
  return apiRequest<LoginResponse>('/auth/login', {
    method: 'POST',
    body: { username, password },
  });
}
