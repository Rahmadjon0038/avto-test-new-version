"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, Pencil, RefreshCw, Search, Ticket, Trash2 } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { useRouter } from "next/navigation";
import { useAuth } from "@/app/auth-provider";
import { jsonOrError } from "@/lib/api-authed";

type AdminTicket = {
  id: string;
  title: string;
  ticketNumber?: number;
  status?: "DRAFT" | "COMPLETED" | string;
  questions: any[];
};

export default function AdminTicketsPage() {
  const qc = useQueryClient();
  const router = useRouter();
  const { authFetch } = useAuth();
  const [search, setSearch] = useState("");

  const ticketsQuery = useQuery({
    queryKey: ["admin-tickets"],
    queryFn: async () => {
      const res = await authFetch("/api/admin/tickets");
      const data = (await jsonOrError(res)) as { tickets: AdminTicket[] };
      return Array.isArray(data.tickets) ? data.tickets : [];
    }
  });

  useEffect(() => {
    if (ticketsQuery.error) toast.error((ticketsQuery.error as any)?.message || "Xatolik");
  }, [ticketsQuery.error]);

  const filteredTickets = useMemo(() => {
    const q = search.trim().toLowerCase();
    const tickets = ticketsQuery.data || [];
    if (!q) return tickets;
    return tickets.filter((ticket) => {
      const title = String(ticket.title || "").toLowerCase();
      const number = String(ticket.ticketNumber || ticket.id || "").toLowerCase();
      const status = String(ticket.status || "").toLowerCase();
      return title.includes(q) || number.includes(q) || status.includes(q);
    });
  }, [search, ticketsQuery.data]);
  const totalTickets = ticketsQuery.data?.length || 0;
  const isLoading = ticketsQuery.isLoading || ticketsQuery.isFetching;

  const deleteMutation = useMutation({
    mutationFn: async (ticketId: string) => {
      const res = await authFetch(`/api/admin/tickets/${encodeURIComponent(ticketId)}`, {
        method: "DELETE"
      });
      return jsonOrError(res);
    },
    onSuccess: async () => {
      toast.success("Bilet o‘chirildi");
      await qc.invalidateQueries({ queryKey: ["admin-tickets"] });
    },
    onError: (error: any) => toast.error(error?.message || "Xatolik")
  });

  return (
    <section className="adminSectionPage">
      <div className="adminSectionHeader">
        <div className="adminTicketActions">
          <button className="btn btn-ghost" type="button" onClick={() => qc.invalidateQueries({ queryKey: ["admin-tickets"] })}>
            <RefreshCw className="lucide" aria-hidden="true" /> Yangilash
          </button>
          <button className="btn btn-primary" type="button" onClick={() => router.push("/admin/ticket-builder")}>
            <Ticket className="lucide" aria-hidden="true" /> Bilet constructor
          </button>
        </div>
      </div>

      <div className="card adminPanelCard">
        <div className="adminPanelCardHead">
          <div className="adminPanelCardTitle">
            <Ticket className="lucide" aria-hidden="true" /> Biletlar
          </div>
          <div className="adminPanelCardDesc">
            Faqat completed biletlar ko‘rinadi. Ichiga kirib savollarni tahrir qilasiz. Jami {totalTickets} ta bilet bor.
          </div>
        </div>

        <div className="adminSearchWrap">
          <Search className="lucide adminSearchIcon" aria-hidden="true" />
          <input
            className="input adminSearchInput"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Bilet nomi yoki raqami bo‘yicha qidiring"
          />
        </div>
      </div>

      <div className="adminTicketsGrid">
        {isLoading ? (
          <section className="adminEmpty card">
            <div className="adminEmptyTitle">Biletlar yuklanmoqda</div>
            <div className="adminEmptyText">Iltimos kuting.</div>
          </section>
        ) : filteredTickets.length ? (
          filteredTickets.map((ticket, index) => (
            <article key={ticket.id} className="card adminTicketCard">
              <div className="adminTicketNumber">{String(ticket.ticketNumber || index + 1).padStart(2, "0")}</div>
              <Link href={`/admin/tickets/${encodeURIComponent(ticket.id)}`} className="adminTicketBody adminTicketBodyLink">
                <div className="adminTicketTitle">{ticket.title || `Bilet №${ticket.ticketNumber || ticket.id}`}</div>
                <div className="adminTicketMeta">{Array.isArray(ticket.questions) ? ticket.questions.filter(Boolean).length : 0} ta to‘ldirilgan savol</div>
                <div className="adminTicketMeta">
                  <span className="badge badge-success">{ticket.status || "COMPLETED"}</span>
                </div>
                <div className="adminTicketMeta">Savollarni tahrirlash uchun oching</div>
              </Link>
              <div className="adminTicketActionsInline">
                <Link
                  href={`/admin/tickets/${encodeURIComponent(ticket.id)}`}
                  className="btn btn-sm adminIconBtn adminIconBtnEdit"
                  title="Tahrirlash"
                  aria-label="Tahrirlash"
                >
                  <Pencil className="lucide" aria-hidden="true" />
                </Link>
                <button
                  className="btn btn-sm adminIconBtn adminIconBtnDelete"
                  type="button"
                  title="O‘chirish"
                  aria-label="O‘chirish"
                  onClick={() => {
                    if (!window.confirm("Biletni o‘chirishni tasdiqlaysizmi?")) return;
                    deleteMutation.mutate(ticket.id);
                  }}
                  disabled={deleteMutation.isPending}
                >
                  <Trash2 className="lucide" aria-hidden="true" />
                </button>
                <Link href={`/admin/tickets/${encodeURIComponent(ticket.id)}`} className="btn btn-sm btn-ghost">
                  Tahrirlash <ArrowRight className="lucide" aria-hidden="true" />
                </Link>
              </div>
            </article>
          ))
        ) : (
          <section className="adminEmpty card">
            <div className="adminEmptyTitle">Bilet topilmadi</div>
            <div className="adminEmptyText">Qidiruv natijasiga mos completed bilet yo‘q.</div>
          </section>
        )}
      </div>
    </section>
  );
}
