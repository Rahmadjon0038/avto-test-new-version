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
        <div className="publicHead">
          <h1 className="publicH1">Biletlar bo‘yicha testlar</h1>
        </div>

        <div className="topicsGrid">
          {tickets.map((t, index) =>
            t.free ? (
              <Link key={t.id} href={`/biletlar/${t.id}`} className="topicCard">
                <span className="topicIndex" aria-hidden="true">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <div className="topicName">{t.title}</div>
              </Link>
            ) : (
              <Link key={t.id} href="/" className="topicCard topicCardLocked">
                <span className="topicLock" aria-hidden="true">
                  <Lock className="lucide" />
                </span>
                <span className="topicIndex" aria-hidden="true">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <div className="topicName">{t.title}</div>
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
