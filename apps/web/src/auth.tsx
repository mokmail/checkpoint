import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import {
  AuthUser,
  getStoredToken,
  getStoredUser,
  fetchMe,
  login as apiLogin,
  register as apiRegister,
  logout as apiLogout,
} from './api';

interface AuthState {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthCtx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(() => getStoredUser());
  const [loading, setLoading] = useState<boolean>(() => !!getStoredToken());

  // On mount: if a token exists, verify it via /users/me
  useEffect(() => {
    const token = getStoredToken();
    if (!token) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    fetchMe()
      .then((u) => { if (!cancelled) { setUser(u); setLoading(false); } })
      .catch(() => { if (!cancelled) { setUser(null); setLoading(false); } });
    return () => { cancelled = true; };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const res = await apiLogin(email, password);
    setUser(res.user);
  }, []);

  const register = useCallback(async (email: string, username: string, password: string) => {
    const res = await apiRegister(email, username, password);
    setUser(res.user);
  }, []);

  const logout = useCallback(async () => {
    await apiLogout();
    setUser(null);
  }, []);

  return (
    <AuthCtx.Provider value={{ user, loading, login, register, logout }}>
      {children}
    </AuthCtx.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}