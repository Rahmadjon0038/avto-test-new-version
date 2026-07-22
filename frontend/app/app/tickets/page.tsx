"use client";

import { useEffect, useState } from "react";
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
  progress?: TicketProgress | null;
};

export default function TicketsPage() {
  const router = useRouter();
  const { authFetch } = useAuth();
  const { t, language } = useSiteLanguage();
  const [tickets, setTickets] = useState<Ticket[]>([]);

  const ticketsQuery = useQuery({
    queryKey: ["tickets", language],
    queryFn: async () => {
      const res = await authFetch("/api/tickets");
      const data = (await jsonOrError(res)) as { tickets: Ticket[] };
      setTickets(Array.isArray(data.tickets) ? data.tickets : []);
      return data;
    }
  });

  useEffect(() => {
    if (ticketsQuery.error) toast.error((ticketsQuery.error as any)?.message || "Xatolik");
  }, [ticketsQuery.error]);

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
            <div className={`ticketCardBody ${ticket.progress ? "" : "isEmpty"}`}>
              <div className="ticketTitle">{ticket.title}</div>
              {ticket.progress ? (
                <>
                  <div className="ticketMiniStats">
                    <span className="ticketMiniStat good">{t("progress.correct", { count: ticket.progress.correctCount })}</span>
                    <span className="ticketMiniStat bad">{t("progress.wrong", { count: ticket.progress.wrongCount })}</span>
                    <span className="ticketMiniStat muted">{t("progress.unanswered", { count: ticket.progress.unansweredCount })}</span>
                  </div>
                </>
              ) : null}
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}
