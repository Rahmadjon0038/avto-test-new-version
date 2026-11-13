"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { ArrowLeft, Eraser, Trash2 } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/app/auth-provider";
import { useSiteLanguage } from "@/app/site-language-provider";
import { jsonOrError } from "@/lib/api-authed";
import { readPersisted, writePersisted } from "@/lib/persisted-cache";

// Ro'yxat faqat "N-bilet" yorlig'i va id'ni chizadi (?lite=1): nom, savollar, progress yuklanmaydi.
type TicketResult = { correct: number; wrong: number; total: number };
type Ticket = {
  id: string;
  number: number;
  // Foydalanuvchining shu biletdagi oxirgi natijasi (yo'q bo'lsa null/undefined).
  result?: TicketResult | null;
};

type TicketsResponse = { tickets: Ticket[] };

export default function TicketsPage() {
  const router = useRouter();
  const { authFetch, authReady } = useAuth();
  const { t, language } = useSiteLanguage();
  const qc = useQueryClient();

  // Ro'yxat uchun faqat id va nom kerak (lite=1): savollar va progress yuklanmaydi.
  // Oxirgi ro'yxat localStorage'dan darhol chiqadi, orqada ETag bilan tekshiriladi.
  const cacheKey = `tickets-lite:${language}`;
  const ticketsQuery = useQuery({
    queryKey: ["tickets", language],
    queryFn: async () => {
      const res = await authFetch("/api/tickets?lite=1", { cache: "no-cache" });
      const data = (await jsonOrError(res)) as TicketsResponse;
      writePersisted(cacheKey, data);
      return data;
    },
    placeholderData: () => readPersisted<TicketsResponse>(cacheKey),
    enabled: authReady
  });

  const tickets = Array.isArray(ticketsQuery.data?.tickets) ? ticketsQuery.data!.tickets : [];
  const hasAnyResult = tickets.some((ticket) => ticket.result);

  // Natijani tozalash: ro'yxat darhol yangilanadi (optimistik), xato bo'lsa qayta yuklanadi.
  const clearMutation = useMutation({
    mutationFn: async (ticketId: string | null) => {
      const url = ticketId ? `/api/ticket-results/${encodeURIComponent(ticketId)}` : "/api/ticket-results";
      const res = await authFetch(url, { method: "DELETE" });
      return jsonOrError(res);
    },
    onMutate: (ticketId) => {
      const next: TicketsResponse = {
        tickets: tickets.map((ticket) => (ticketId === null || ticket.id === ticketId ? { ...ticket, result: null } : ticket))
      };
      qc.setQueryData(["tickets", language], next);
      writePersisted(cacheKey, next);
    },
    onError: (error: any) => toast.error(error?.message || "Xatolik"),
    onSettled: () => qc.invalidateQueries({ queryKey: ["tickets"] })
  });

  function clearAll() {
    if (!hasAnyResult) return;
    if (window.confirm(t("tickets.clearAllConfirm"))) clearMutation.mutate(null);
  }

  useEffect(() => {
    if (ticketsQuery.error) toast.error((ticketsQuery.error as any)?.message || "Xatolik");
  }, [ticketsQuery.error]);

  const isTicketsLoading = !authReady || (!ticketsQuery.data && (ticketsQuery.isPending || ticketsQuery.isLoading || ticketsQuery.isFetching));

  if (isTicketsLoading) {
    // Spinner o'rniga sahifa tuzilmasi darhol chiziladi: foydalanuvchi kutayotganini emas,
    // sahifa ochilganini ko'radi.
    return (
      <section className="view" aria-busy="true">
        <div className="ticketsHeader card">
          <button className="btn btn-ghost btn-sm ticketsBackBtn" type="button" onClick={() => router.push("/app")}>
            <ArrowLeft className="lucide" aria-hidden="true" /> {t("common.back")}
          </button>
          <div className="ticketsHeaderTitle">{t("tickets.title")}</div>
        </div>
        <div className="ticketsGrid ticketsGridCompact" aria-label={t("common.loading")}>
          {Array.from({ length: 24 }, (_, index) => (
            <div key={index} className="card ticketCard ticketCardCompact ticketCardSkeleton" aria-hidden="true" />
          ))}
        </div>
      </section>
    );
  }

  return (
    <section className="view">
      <div className="ticketsHeader card">
        <button className="btn btn-ghost btn-sm ticketsBackBtn" type="button" onClick={() => router.push("/app")}>
          <ArrowLeft className="lucide" aria-hidden="true" /> {t("common.back")}
        </button>
        <div className="ticketsHeaderTitle">{t("tickets.title")}</div>
        <button className="btn btn-ghost btn-sm ticketsClearAllBtn" type="button" onClick={clearAll} disabled={!hasAnyResult || clearMutation.isPending}>
          <Trash2 className="lucide" aria-hidden="true" /> {t("tickets.clearAll")}
        </button>
      </div>

      <div className="ticketsGrid ticketsGridCompact">
        {tickets.map((ticket, index) => (
          <div key={ticket.id} className="ticketCardWrap">
            <button
              className="card ticketCard ticketCardCompact"
              type="button"
              aria-label={`${formatTicketLabel(index)} ni ochish`}
              onClick={() => router.push(`/app/ticket/${encodeURIComponent(ticket.id)}`)}
            >
              <div className="ticketCardBody isEmpty">
                <div className="ticketTitle ticketTitleNumbered">{formatTicketLabel(index)}</div>
                {ticket.result ? (
                  <div className="ticketLastResult">{t("tickets.lastResult", { correct: ticket.result.correct, wrong: ticket.result.wrong })}</div>
                ) : null}
              </div>
            </button>
            {ticket.result ? (
              <button
                className="ticketClearBtn"
                type="button"
                title={t("tickets.clear")}
                aria-label={`${formatTicketLabel(index)}: ${t("tickets.clear")}`}
                onClick={() => clearMutation.mutate(ticket.id)}
              >
                <Eraser className="lucide" aria-hidden="true" /> {t("tickets.clear")}
              </button>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}

function formatTicketLabel(index: number) {
  return `${index + 1}-bilet`;
}
