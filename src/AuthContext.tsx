import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from "react";
import { getMe } from "./api";
import type { User } from "./types";

interface AuthState {
  user: User | null;
  loading: boolean;
  isLoggedIn: boolean;
  refresh: () => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthState>({
  user: null,
  loading: true,
  isLoggedIn: false,
  refresh: async () => {},
  logout: () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const token = localStorage.getItem("vibecheck_token");
    if (!token) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      const me = await getMe();
      setUser(me);
    } catch {
      localStorage.removeItem("vibecheck_token");
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const logout = useCallback(() => {
    localStorage.removeItem("vibecheck_token");
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, isLoggedIn: !!user, refresh, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
