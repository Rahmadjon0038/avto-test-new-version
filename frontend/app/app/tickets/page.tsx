"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { ArrowLeft } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/app/auth-provider";
import { useSiteLanguage } from "@/app/site-language-provider";
import { jsonOrError } from "@/lib/api-authed";

type TicketProgress = {
  ticketId: string;
  completed: boolean;
  score: number;
  updatedAt: string | null;
  totalCount: number;
  answeredCount: number;
  correctCount: number;
  wrongCount: number;
  unansweredCount: number;
};

type Ticket = {
  id: string;
  title: string;
  locked: boolean;
};

export default function TicketsPage() {
  const router = useRouter();
  const { authFetch, authReady } = useAuth();
  const { t, language } = useSiteLanguage();

  const ticketsQuery = useQuery({
    queryKey: ["tickets", language],
    queryFn: async () => {
      const res = await authFetch("/api/tickets");
      return (await jsonOrError(res)) as { tickets: Ticket[] };
    },
    enabled: authReady
  });

  const tickets = Array.isArray(ticketsQuery.data?.tickets) ? ticketsQuery.data!.tickets : [];

  useEffect(() => {
    if (ticketsQuery.error) toast.error((ticketsQuery.error as any)?.message || "Xatolik");
  }, [ticketsQuery.error]);

  const isTicketsLoading = !authReady || (!ticketsQuery.data && (ticketsQuery.isPending || ticketsQuery.isLoading || ticketsQuery.isFetching));

  if (isTicketsLoading) {
    return (
      <section className="view">
        <div className="examLoadingView">
          <div className="examLoadingCard">
            <div className="examLoadingSpinnerWrap">
              <span className="examLoadingSpinner" />
            </div>
            <div className="examLoadingTitle">{t("tickets.loading")}</div>
            <div className="examLoadingText">{t("common.loading")}</div>
          </div>
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

      <div className="ticketsGrid">
        {tickets.map((ticket) => (
          <button
            key={ticket.id}
            className="card ticketCard"
            type="button"
            onClick={() => router.push(`/app/ticket/${encodeURIComponent(ticket.id)}`)}
          >
            <div className="ticketCardBody isEmpty">
              <div className="ticketTitle">{ticket.title}</div>
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}
