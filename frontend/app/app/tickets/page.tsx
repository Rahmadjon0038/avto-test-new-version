"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { ArrowLeft } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/app/auth-provider";
import { useSiteLanguage } from "@/app/site-language-provider";
import { jsonOrError } from "@/lib/api-authed";
import { readPersisted, writePersisted } from "@/lib/persisted-cache";

// Ro'yxat faqat "N-bilet" yorlig'i va id'ni chizadi (?lite=1): nom, savollar, progress yuklanmaydi.
type Ticket = {
  id: string;
  number: number;
};

type TicketsResponse = { tickets: Ticket[] };

export default function TicketsPage() {
  const router = useRouter();
  const { authFetch, authReady } = useAuth();
  const { t, language } = useSiteLanguage();

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
      </div>

      <div className="ticketsGrid ticketsGridCompact">
        {tickets.map((ticket, index) => (
          <button
            key={ticket.id}
            className="card ticketCard ticketCardCompact"
            type="button"
            aria-label={`${formatTicketLabel(index)} ni ochish`}
            onClick={() => router.push(`/app/ticket/${encodeURIComponent(ticket.id)}`)}
          >
            <div className="ticketCardBody isEmpty">
              <div className="ticketTitle ticketTitleNumbered">{formatTicketLabel(index)}</div>
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}

function formatTicketLabel(index: number) {
  return `${index + 1}-bilet`;
}
