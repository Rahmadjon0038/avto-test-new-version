"use client";

import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/app/auth-provider";
import { jsonOrError } from "./api-authed";

// Token yangilanganda (refresh) o'zgarmaydigan kalit: JWT ichidagi `sub`. Ilgari kalit butun token
// edi, shuning uchun har refreshda /api/auth/me qayta so'rovga ketardi; topic sahifasi esa o'z
// kaliti bilan (`topic-me`) bir xil so'rovni ikkinchi marta yuborardi.
function subjectFromToken(token: string | null): string {
  if (!token) return "anonymous";
  try {
    const payload = token.split(".")[0].replace(/-/g, "+").replace(/_/g, "/");
    const json = JSON.parse(atob(payload.padEnd(Math.ceil(payload.length / 4) * 4, "=")));
    return String(json?.sub || "anonymous");
  } catch {
    return "anonymous";
  }
}

export function useMe() {
  const { authFetch, authReady, accessToken } = useAuth();
  return useQuery({
    queryKey: ["me", subjectFromToken(accessToken)],
    queryFn: async () => jsonOrError(await authFetch("/api/auth/me")),
    retry: false,
    staleTime: 5 * 60 * 1000,
    enabled: authReady && Boolean(accessToken)
  });
}
