"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import toast from "react-hot-toast";
import { useCookies } from "react-cookie";
import { appendLanguageQuery, getBrowserLanguage, getTranslation } from "@/lib/site-language";

type AuthContextValue = {
  accessToken: string | null;
  setAccessToken: (t: string | null) => void;
  user: any | null;
  setUser: (user: any | null) => void;
  authReady: boolean;
  authFetch: (path: string, init?: RequestInit) => Promise<Response>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

async function tryJson(res: Response) {
  return res.json().catch(() => ({}));
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [cookies, setCookie, removeCookie] = useCookies(["accessToken", "authUser"]);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [user, setUser] = useState<any | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const accessTokenRef = useRef<string | null>(null);
  const refreshInFlightRef = useRef<Promise<string | null> | null>(null);

  const setToken = useCallback((t: string | null) => {
    accessTokenRef.current = t;
    setAccessToken(t);
    if (t) {
      setCookie("accessToken", t, { path: "/", sameSite: "lax", maxAge: 60 * 60 * 24 * 30 });
    } else {
      removeCookie("accessToken", { path: "/" });
    }
  }, [removeCookie, setCookie]);

  const setProfile = useCallback((nextUser: any | null) => {
    setUser(nextUser);
    if (nextUser) {
      setCookie("authUser", JSON.stringify(nextUser), { path: "/", sameSite: "lax", maxAge: 60 * 60 * 24 * 30 });
    } else {
      removeCookie("authUser", { path: "/" });
    }
  }, [removeCookie, setCookie]);

  const refresh = useCallback(async () => {
    if (refreshInFlightRef.current) return refreshInFlightRef.current;
    refreshInFlightRef.current = (async () => {
      const res = await fetch("/api/auth/refresh", { method: "POST" });
      if (!res.ok) return null;
      const data: any = await tryJson(res);
      const token = data?.accessToken ? String(data.accessToken) : null;
      if (token) setToken(token);
      return token;
    })().finally(() => {
      refreshInFlightRef.current = null;
    });
    return refreshInFlightRef.current;
  }, []);

  useEffect(() => {
    // Restore the last known session from cookies first.
    const storedToken = cookies.accessToken ? String(cookies.accessToken) : null;
    const storedUser = cookies.authUser ? String(cookies.authUser) : null;
    if (storedToken) {
      accessTokenRef.current = storedToken;
      setAccessToken(storedToken);
    }
    if (storedUser) {
      try {
        setUser(JSON.parse(storedUser));
      } catch {
        setProfile(null);
      }
    }

    if (accessTokenRef.current) {
      setAuthReady(true);
      return;
    }

    // On first load without a stored token, try to get a fresh access token from the refresh cookie.
    refresh()
      .catch(() => {})
      .finally(() => setAuthReady(true));
  }, [cookies.accessToken, cookies.authUser, refresh, setAuthReady, setProfile]);

  const authFetch = useCallback(
    async (path: string, init?: RequestInit) => {
      // If token is missing, try refresh once before the first request.
      let token = accessTokenRef.current;
      if (!token) token = await refresh();

      const requestPath = appendLanguageQuery(path, getBrowserLanguage());
      const headers = new Headers(init?.headers);
      if (token) headers.set("authorization", `Bearer ${token}`);
      let res = await fetch(requestPath, { ...init, headers });

      if (res.status !== 401) return res;

      // Try refresh once, then retry.
      const refreshed = await refresh();
      if (!refreshed) return res;
      const headers2 = new Headers(init?.headers);
      headers2.set("authorization", `Bearer ${refreshed}`);
      res = await fetch(requestPath, { ...init, headers: headers2 });
      return res;
    },
    [refresh]
  );

  const logout = useCallback(async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {}
    setToken(null);
    setProfile(null);
    toast.success(getTranslation(getBrowserLanguage(), "common.close"));
  }, [setToken, setProfile]);

  const value = useMemo(
    () => ({ accessToken, setAccessToken: setToken, user, setUser: setProfile, authReady, authFetch, logout }),
    [accessToken, setToken, user, setProfile, authReady, authFetch, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const v = useContext(AuthContext);
  if (!v) throw new Error("useAuth must be used within AuthProvider");
  return v;
}
