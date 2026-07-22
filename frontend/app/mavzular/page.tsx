import type { Metadata } from "next";
import Link from "next/link";
import { Lock } from "lucide-react";
import { siteName, getSiteUrl } from "@/lib/site";
import { fetchPublicTopics } from "@/lib/server-api";
import PublicShell from "@/app/ui/public-shell";
import { RegisterCta, buildItemListJsonLd, buildBreadcrumbJsonLd } from "@/app/ui/public-questions";
import { getServerLanguage } from "@/lib/site-language-server";
import { getTranslation } from "@/lib/site-language";

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
  const lang = await getServerLanguage();
  const t = (key: string, vars?: Record<string, string | number>) => getTranslation(lang, key, vars);
  const topics = await fetchPublicTopics(lang);
  const base = getSiteUrl().toString().replace(/\/$/, "");
  const itemListJsonLd = buildItemListJsonLd(
    t("topics.title"),
    topics.map((t) => ({ name: t.title, url: t.free ? `${base}/mavzular/${t.id}` : undefined }))
  );
  const breadcrumbJsonLd = buildBreadcrumbJsonLd([
    { name: t("common.back"), url: `${base}/` },
    { name: t("footer.topics"), url: `${base}/mavzular` }
  ]);

  return (
    <PublicShell>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(itemListJsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }} />
      <section className="view">
        <div className="publicHead">
          <h1 className="publicH1">{t("topics.title")}</h1>
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
              <Link key={t.id} href="/?auth=register" className="topicCard topicCardLocked">
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

        {topics.length === 0 ? <div className="muted">{t("topics.empty")}</div> : null}

        <RegisterCta />
      </section>
    </PublicShell>
  );
}
