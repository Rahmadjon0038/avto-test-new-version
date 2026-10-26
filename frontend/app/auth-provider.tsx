"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import toast from "react-hot-toast";
import { useCookies } from "react-cookie";
import { getBrowserLanguage, getTranslation } from "@/lib/site-language";
import { clearUserScopedCaches } from "@/lib/content-db";
import { clearPersisted } from "@/lib/persisted-cache";

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

// Foydalanuvchi profili ilgari `authUser` cookie'sida saqlanardi: cookie har bir so'rovga
// (sahifa, JS/CSS, rasm, API) qo'shilib ketadi — sekin internetda har so'rovga yarim kilobayt
// ortiqcha yuk. Endi profil localStorage'da, cookie'da faqat accessToken qoladi.
const AUTH_USER_STORAGE_KEY = "topshirdi_auth_user_v1";

function readStoredUser(): any | null {
  try {
    const raw = window.localStorage.getItem(AUTH_USER_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeStoredUser(user: any | null) {
  try {
    if (user) window.localStorage.setItem(AUTH_USER_STORAGE_KEY, JSON.stringify(user));
    else window.localStorage.removeItem(AUTH_USER_STORAGE_KEY);
  } catch {
    // storage mavjud emas — profil keyingi /api/auth/me bilan tiklanadi.
  }
}

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
    writeStoredUser(nextUser);
    // Eski versiyadan qolgan cookie (agar bo'lsa) so'rovlarni og'irlashtirmasligi uchun o'chiriladi.
    removeCookie("authUser", { path: "/" });
  }, [removeCookie]);

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
    // Eski `authUser` cookie'si bo'lsa, bir marta localStorage'ga ko'chiramiz va cookie'ni o'chiramiz.
    const legacyUser = cookies.authUser ? String(cookies.authUser) : null;
    if (storedToken) {
      accessTokenRef.current = storedToken;
      setAccessToken(storedToken);
    }
    if (legacyUser) {
      try {
        const migrated = typeof cookies.authUser === "object" ? cookies.authUser : JSON.parse(legacyUser);
        writeStoredUser(migrated);
      } catch {
        // buzilgan cookie — e'tiborsiz qoldiriladi
      }
      removeCookie("authUser", { path: "/" });
    }
    const storedUser = readStoredUser();
    if (storedUser) setUser(storedUser);

    if (accessTokenRef.current) {
      setAuthReady(true);
      return;
    }

    // On first load without a stored token, try to get a fresh access token from the refresh cookie.
    refresh()
      .catch(() => {})
      .finally(() => setAuthReady(true));
  }, [cookies.accessToken, cookies.authUser, refresh, removeCookie, setAuthReady]);

  const authFetch = useCallback(
    async (path: string, init?: RequestInit) => {
      // If token is missing, try refresh once before the first request.
      let token = accessTokenRef.current;
      if (!token) token = await refresh();

      const [basePath, queryString = ""] = String(path || "").split("?");
      const params = new URLSearchParams(queryString);
      if (!params.has("lang")) {
        params.set("lang", getBrowserLanguage());
      }
      const requestPath = `${basePath}?${params.toString()}`;
      const headers = new Headers(init?.headers);
      if (token) headers.set("authorization", `Bearer ${token}`);
      const method = String(init?.method || "GET").toUpperCase();
      // GET'lar odatda no-store; ETag bilan tekshiriladigan ro'yxatlar `cache: "no-cache"` berib
      // 304 (bo'sh javob) olishi mumkin.
      const cacheMode = init?.cache ?? (method === "GET" ? "no-store" : undefined);
      let res = await fetch(requestPath, {
        ...init,
        headers,
        cache: cacheMode,
      });

      if (res.status !== 401) return res;

      // Try refresh once, then retry.
      const refreshed = await refresh();
      if (!refreshed) return res;
      const headers2 = new Headers(init?.headers);
      headers2.set("authorization", `Bearer ${refreshed}`);
      res = await fetch(requestPath, {
        ...init,
        headers: headers2,
        cache: cacheMode,
      });
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
    // Mistakes/exam snapshots are per-user progress cached locally — wipe them so a different
    // account signing in on this device never sees the previous user's data. The shared question
    // content cache (topics/tickets/customTests) is intentionally left alone.
    clearUserScopedCaches().catch(() => {});
    clearPersisted();
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
