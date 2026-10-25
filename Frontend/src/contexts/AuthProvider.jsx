import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import { AuthContext } from "./AuthContext";
import { authApi } from "../features/auth/api/authApi";
import { setAccessToken } from "../api/axiosClient";

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [isInitializing, setIsInitializing] = useState(true);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  useEffect(() => {
    let active = true;

    async function initialize() {
      try {
        const result = await authApi.refresh();

        if (!active) return;

        setAccessToken(result.accessToken);
        setUser(result.user);
      } catch {
        if (!active) return;

        setAccessToken(null);
        setUser(null);
      } finally {
        if (active) {
          setIsInitializing(false);
        }
      }
    }

    initialize();

    return () => {
      active = false;
    };
  }, []);

  const login = useCallback(async (identifier, password) => {
    setIsLoggingIn(true);

    try {
      const result = await authApi.login(identifier, password);

      setAccessToken(result.accessToken);
      setUser(result.user);

      return result.user;
    } finally {
      setIsLoggingIn(false);
    }
  }, []);

  const register = useCallback(async (data) => {
    return authApi.register(data);
  }, []);

  const logout = useCallback(async () => {
    setIsLoggingOut(true);

    try {
      await authApi.logout();

      setAccessToken(null);
      setUser(null);
    } finally {
      setIsLoggingOut(false);
    }
  }, []);

  const reloadUser = useCallback(async () => {
    const result = await authApi.getMe();
    setUser(result);
    return result;
  }, []);

  const value = useMemo(
    () => ({
      user,
      isAuthenticated: Boolean(user),
      isInitializing,
      isLoggingIn,
      isLoggingOut,
      login,
      register,
      logout,
      reloadUser,
    }),
    [
      user,
      isInitializing,
      isLoggingIn,
      isLoggingOut,
      login,
      register,
      logout,
      reloadUser,
    ]
  );

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}