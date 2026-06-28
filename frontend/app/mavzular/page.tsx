import type { Metadata } from "next";
import Link from "next/link";
import { Lock } from "lucide-react";
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

  return (
    <PublicShell>
      <section className="view">
        <div className="publicHead">
          <h1 className="publicH1">Mavzu bo‘yicha testlar</h1>
        </div>

        <div className="topicsGrid">
          {topics.map((t, index) =>
            t.free ? (
              <Link key={t.id} href={`/mavzular/${t.id}`} className="topicCard">
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

        {topics.length === 0 ? <div className="muted">Mavzular hozircha mavjud emas.</div> : null}

        <RegisterCta />
      </section>
    </PublicShell>
  );
}
