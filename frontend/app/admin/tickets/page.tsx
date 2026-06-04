"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Plus, Pencil, Ticket, Trash2 } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { useAuth } from "@/app/auth-provider";
import { jsonOrError } from "@/lib/api-authed";

type AdminTicket = {
  id: string;
  title: string;
  questions: any[];
};

export default function AdminTicketsPage() {
  const qc = useQueryClient();
  const { authFetch } = useAuth();
  const [title, setTitle] = useState("");

  const ticketsQuery = useQuery({
    queryKey: ["admin-tickets"],
    queryFn: async () => {
      const res = await authFetch("/api/admin/tickets");
      const data = (await jsonOrError(res)) as { tickets: AdminTicket[] };
      return Array.isArray(data.tickets) ? data.tickets : [];
    }
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await authFetch("/api/admin/tickets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title })
      });
      return (await jsonOrError(res)) as { ticket: AdminTicket };
    },
    onSuccess: async (data) => {
      toast.success("Bilet yaratildi");
      setTitle("");
      await qc.invalidateQueries({ queryKey: ["admin-tickets"] });
    },
    onError: (error: any) => toast.error(error?.message || "Xatolik")
  });

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

  useEffect(() => {
    if (ticketsQuery.error) toast.error((ticketsQuery.error as any)?.message || "Xatolik");
  }, [ticketsQuery.error]);

  return (
    <section className="adminSectionPage">
      <div className="adminSectionHeader">
      </div>

      <div className="card adminPanelCard">
        <div className="adminPanelCardHead">
          <div className="adminPanelCardTitle">
            <Ticket className="lucide" aria-hidden="true" /> Yangi bilet qo‘shish
          </div>
        </div>

        <form
          className="adminTicketCreate"
          onSubmit={(event) => {
            event.preventDefault();
            createMutation.mutate();
          }}
        >
          <input
            id="new-ticket"
            className="input"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Masalan: 6-bilet"
          />
          <button className="btn btn-primary" type="submit" disabled={createMutation.isPending || !title.trim()}>
            <Plus className="lucide" aria-hidden="true" /> Saqlash
          </button>
        </form>
      </div>

      <div className="adminTicketsGrid">
        {ticketsQuery.data?.map((ticket, index) => (
          <article key={ticket.id} className="card adminTicketCard">
            <div className="adminTicketNumber">{String(index + 1).padStart(2, "0")}</div>
            <Link href={`/admin/tickets/${encodeURIComponent(ticket.id)}`} className="adminTicketBody adminTicketBodyLink">
              <div className="adminTicketTitle">{ticket.title}</div>
              <div className="adminTicketMeta">{ticket.questions.length} savol</div>
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
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
