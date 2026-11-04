import { createContext, useCallback, useContext, useEffect, useMemo, useState, ReactNode } from "react";
import axios from "axios";
import { AuthUser, loginRequest, meRequest, registerRequest } from "../api/authApi";
import { clearToken, getToken, setToken } from "../api/client";

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  /** Set when the initial /api/auth/me check fails for a reason other than "not logged in"
   * (timeout, network error, server down) — ProtectedRoute shows this with a retry button
   * instead of hanging on a bare loading state forever. */
  authError: string | null;
  retryAuthCheck: () => void;
  login: (identifier: string, password: string) => Promise<void>;
  register: (email: string, username: string, password: string) => Promise<void>;
  logout: () => void;
  setBalance: (balance: number) => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    const token = getToken();
    if (!token) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setAuthError(null);
    meRequest()
      .then((loggedInUser) => setUser(loggedInUser))
      .catch((err) => {
        // Only a genuine "this token is invalid" response should log the user out — a
        // timeout or network failure (unreachable/misconfigured backend) shouldn't silently
        // discard a possibly-still-valid token, it should surface as a retryable error
        // instead of either hanging forever or forcing a re-login.
        if (axios.isAxiosError(err) && err.response?.status === 401) {
          clearToken();
          setUser(null);
          return;
        }
        setAuthError(
          "Couldn't reach the server to verify your session. Check your connection and try again."
        );
      })
      .finally(() => setLoading(false));
  }, [retryCount]);

  const retryAuthCheck = useCallback(() => setRetryCount((c) => c + 1), []);

  const login = useCallback(async (identifier: string, password: string) => {
    const { token, user: loggedInUser } = await loginRequest(identifier, password);
    setToken(token);
    setUser(loggedInUser);
  }, []);

  const register = useCallback(async (email: string, username: string, password: string) => {
    const { token, user: newUser } = await registerRequest(email, username, password);
    setToken(token);
    setUser(newUser);
  }, []);

  const logout = useCallback(() => {
    clearToken();
    setUser(null);
  }, []);

  const setBalance = useCallback((balance: number) => {
    setUser((prev) => (prev ? { ...prev, balance } : prev));
  }, []);

  const value = useMemo(
    () => ({ user, loading, authError, retryAuthCheck, login, register, logout, setBalance }),
    [user, loading, authError, retryAuthCheck, login, register, logout, setBalance]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
