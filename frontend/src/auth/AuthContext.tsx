import { createContext, ReactNode, useCallback, useContext, useMemo, useState } from 'react';
import { login as loginRequest } from '../api/auth';
import { loadSession, saveSession, Session, sessionFromToken } from './session';

interface AuthContextValue {
  session: Session | null;
  login(username: string, password: string): Promise<void>;
  logout(): void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(() => loadSession());

  const login = useCallback(async (username: string, password: string) => {
    const { accessToken, expiresIn } = await loginRequest(username, password);
    const next = sessionFromToken(accessToken, username, expiresIn);
    saveSession(next);
    setSession(next);
  }, []);

  const logout = useCallback(() => {
    saveSession(null);
    setSession(null);
  }, []);

  const value = useMemo(() => ({ session, login, logout }), [session, login, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth debe usarse dentro de <AuthProvider>.');
  return context;
}
