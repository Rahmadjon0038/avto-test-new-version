"use client";

import { useMemo } from "react";
import { useQuery, type QueryKey } from "@tanstack/react-query";
import { readPersisted, writePersisted } from "./persisted-cache";

// Admin ro'yxat sahifalari uchun: oxirgi muvaffaqiyatli javob saqlanadi va sahifa ochilganda darhol
// ko'rsatiladi (server sekin yoki javob bermasa ham sahifa bo'sh/"jim" qolmaydi). Yangi javob kelgach
// almashadi. Server xato bersa va saqlangan nusxa ham yo'q bo'lsa, `loadError` to'ldiriladi
// (sahifa "Qayta urinish" tugmasi bilan xato kartasini ko'rsatadi).
export function useAdminQuery<T>({
  queryKey,
  persistKey,
  queryFn
}: {
  queryKey: QueryKey;
  persistKey: string;
  queryFn: () => Promise<T>;
}) {
  const cacheKey = `admin:${persistKey}`;
  const query = useQuery<T>({
    queryKey,
    queryFn: async () => {
      const data = await queryFn();
      writePersisted(cacheKey, data);
      return data;
    },
    // Generik T funksiya bo'lishi ham mumkin degan tur cheklovi uchun `as any`.
    placeholderData: (() => readPersisted<T>(cacheKey)) as any,
    // Admin har safar sahifani ochganda eng yangi ma'lumotni ko'rishi kerak.
    refetchOnMount: "always",
    staleTime: 15 * 1000
  });

  // Xatodan keyin placeholder yo'qoladi: saqlangan nusxaga qaytamiz.
  const fallback = useMemo(
    () => (query.data === undefined && query.isError ? readPersisted<T>(cacheKey) : undefined),
    [query.data, query.isError, cacheKey]
  );
  const data = (query.data ?? fallback) as T | undefined;
  const loadError = data === undefined && query.isError ? String((query.error as any)?.message || "Yuklab bo‘lmadi") : "";

  return {
    data,
    error: query.error,
    isError: query.isError,
    isFetching: query.isFetching,
    // Faqat ko'rsatadigan ma'lumot umuman yo'q paytda true (fon yangilanishi sahifani yashirmaydi).
    isLoading: data === undefined && query.isPending,
    loadError,
    refetch: query.refetch
  };
}
