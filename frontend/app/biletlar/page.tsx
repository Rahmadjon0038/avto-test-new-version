import type { Metadata } from "next";
import Link from "next/link";
import { Lock, ArrowRight } from "lucide-react";
import { siteName } from "@/lib/site";
import { fetchPublicTickets } from "@/lib/server-api";
import PublicShell from "@/app/ui/public-shell";
import { RegisterCta } from "@/app/ui/public-questions";

export const revalidate = 300;

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
  const freeCount = tickets.filter((t) => t.free).length;

  return (
    <PublicShell>
      <section className="view">
        <div className="publicHead">
          <h1 className="publicH1">Biletlar bo‘yicha testlar</h1>
          <p className="publicLead">
            Rasmiy biletlar formatidagi testlar. {freeCount > 0 ? `Birinchi ${freeCount} ta bilet hamma uchun bepul ochiq` : "Biletlar ro‘yxati"} — savollar,
            to‘g‘ri javoblar va izohlar bilan.
          </p>
        </div>

        <div className="publicList">
          {tickets.map((t) =>
            t.free ? (
              <Link key={t.id} href={`/biletlar/${t.id}`} className="publicListItem">
                <span className="publicListMain">
                  <span className="publicListTitle">{t.title}</span>
                  <span className="publicListDesc">{t.questionCount} ta savol · bepul</span>
                </span>
                <ArrowRight className="lucide" aria-hidden="true" />
              </Link>
            ) : (
              <Link key={t.id} href="/" className="publicListItem publicListItemLocked">
                <span className="publicListMain">
                  <span className="publicListTitle">{t.title}</span>
                  <span className="publicListDesc">Ro‘yxatdan o‘tgandan keyin ochiladi</span>
                </span>
                <Lock className="lucide" aria-hidden="true" />
              </Link>
            )
          )}
          {tickets.length === 0 ? <div className="muted">Biletlar hozircha mavjud emas.</div> : null}
        </div>

        <RegisterCta />
      </section>
    </PublicShell>
  );
}
