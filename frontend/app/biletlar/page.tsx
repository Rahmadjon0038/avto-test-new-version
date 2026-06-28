import type { Metadata } from "next";
import Link from "next/link";
import { Lock } from "lucide-react";
import { siteName } from "@/lib/site";
import { fetchPublicTickets } from "@/lib/server-api";
import PublicShell from "@/app/ui/public-shell";
import { RegisterCta } from "@/app/ui/public-questions";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Biletlar bo‘yicha testlar — savol va javoblar",
  description:
    "Haydovchilik biletlari bo‘yicha testlar. Birinchi biletlar bepul: savollar, to‘g‘ri javoblar va izohlar bilan. Avto imtihonga tayyorlaning.",
  alternates: { canonical: "/biletlar" },
  openGraph: {
    title: `Biletlar bo‘yicha testlar | ${siteName}`,
    description: "Haydovchilik biletlari — savollar, to‘g‘ri javoblar va izohlar bilan.",
    url: "/biletlar",
    type: "website",
    locale: "uz_UZ"
  }
};

export default async function BiletlarPage() {
  const tickets = await fetchPublicTickets();

  return (
    <PublicShell>
      <section className="view">
        <div className="ticketsHeader card">
          <div className="ticketsHeaderTitle">Biletlar bo‘yicha testlar</div>
        </div>

        <div className="ticketsGrid">
          {tickets.map((t) =>
            t.free ? (
              <Link key={t.id} href={`/biletlar/${t.id}`} className="card ticketCard">
                <div className="ticketTitle">{t.title}</div>
              </Link>
            ) : (
              <Link key={t.id} href="/?auth=register" className="card ticketCard ticketCardLocked">
                <span className="lock" aria-hidden="true">
                  <Lock className="lucide" />
                </span>
                <div className="ticketTitle">{t.title}</div>
              </Link>
            )
          )}
        </div>

        {tickets.length === 0 ? <div className="muted">Biletlar hozircha mavjud emas.</div> : null}

        <RegisterCta />
      </section>
    </PublicShell>
  );
}
