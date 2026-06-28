import type { Metadata } from "next";
import Link from "next/link";
import { Lock, ArrowRight } from "lucide-react";
import { siteName } from "@/lib/site";
import { fetchPublicTopics } from "@/lib/server-api";
import PublicShell from "@/app/ui/public-shell";
import { RegisterCta } from "@/app/ui/public-questions";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Mavzu bo‘yicha testlar — yo‘l belgilari va qoidalar",
  description:
    "Yo‘l harakati qoidalari va belgilar mavzular bo‘yicha testlar. Birinchi mavzu hamma uchun bepul: savollar, to‘g‘ri javoblar va izohlar bilan.",
  alternates: { canonical: "/mavzular" },
  openGraph: {
    title: `Mavzu bo‘yicha testlar | ${siteName}`,
    description: "Yo‘l belgilari va qoidalar mavzular bo‘yicha — savollar, javoblar va izohlar.",
    url: "/mavzular",
    type: "website",
    locale: "uz_UZ"
  }
};

export default async function MavzularPage() {
  const topics = await fetchPublicTopics();
  const freeCount = topics.filter((t) => t.free).length;

  return (
    <PublicShell>
      <section className="view">
        <div className="publicHead">
          <h1 className="publicH1">Mavzu bo‘yicha testlar</h1>
          <p className="publicLead">
            Belgilar va qoidalarni bo‘limma-bo‘lim o‘rganing. {freeCount > 0 ? `Birinchi mavzu hamma uchun bepul ochiq` : "Mavzular ro‘yxati"} — savollar,
            to‘g‘ri javoblar va izohlar bilan.
          </p>
        </div>

        <div className="publicList">
          {topics.map((t) =>
            t.free ? (
              <Link key={t.id} href={`/mavzular/${t.id}`} className="publicListItem">
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
          {topics.length === 0 ? <div className="muted">Mavzular hozircha mavjud emas.</div> : null}
        </div>

        <RegisterCta />
      </section>
    </PublicShell>
  );
}
