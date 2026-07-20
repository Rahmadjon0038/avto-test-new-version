"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { ArrowLeft } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { useAuth } from "@/app/auth-provider";
import { jsonOrError } from "@/lib/api-authed";
import ProgressLineChart from "@/app/ui/progress-line-chart";

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
  const [tickets, setTickets] = useState<Ticket[]>([]);

  const ticketsQuery = useQuery({
    queryKey: ["tickets"],
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
          <ArrowLeft className="lucide" aria-hidden="true" /> Orqaga
        </button>
        <div className="ticketsHeaderTitle">Biletlar bo‘yicha testlar</div>
      </div>

      <div className="ticketsGrid">
        {tickets.map((t) => (
          <button
            key={t.id}
            className="card ticketCard"
            type="button"
            onClick={() => router.push(`/app/ticket/${encodeURIComponent(t.id)}`)}
          >
            <div className="ticketCardBody">
              <div className="ticketTitle">{t.title}</div>
              {t.progress ? (
                <ProgressLineChart
                  correct={t.progress.correctCount}
                  wrong={t.progress.wrongCount}
                  unanswered={t.progress.unansweredCount}
                  title="Bilet progressi"
                  className="ticketProgressChart"
                />
              ) : (
                <div className="ticketProgress ticketProgressEmpty">
                  <span className="ticketProgressItem mutedItem">Natija hali yo‘q</span>
                </div>
              )}
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}
