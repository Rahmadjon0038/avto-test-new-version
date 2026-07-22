import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Lock } from "lucide-react";
import { siteName } from "@/lib/site";
import { fetchPublicTicket } from "@/lib/server-api";
import PublicShell from "@/app/ui/public-shell";
import PublicTestRunner from "@/app/ui/public-test-runner";
import { RegisterCta, buildFaqJsonLd, buildBreadcrumbJsonLd } from "@/app/ui/public-questions";
import { getServerLanguage } from "@/lib/site-language-server";
import { getTranslation } from "@/lib/site-language";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ ticketId: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { ticketId } = await params;
  const lang = await getServerLanguage();
  const t = (key: string, vars?: Record<string, string | number>) => getTranslation(lang, key, vars);
  const { ticket, status } = await fetchPublicTicket(ticketId, lang);
  const title = ticket ? `${ticket.title} — ${t("tickets.title")}` : t("tickets.title");
  return {
    title,
    description: ticket
      ? `${ticket.title}: ${ticket.questions.length} ta savol, to‘g‘ri javoblar va izohlar bilan. Avto imtihonga bepul tayyorlaning.`
      : t("tickets.title"),
    alternates: { canonical: `/biletlar/${ticketId}` },
    robots: status === 403 ? { index: false, follow: true } : undefined,
    openGraph: {
      title: `${title} | ${siteName}`,
      description: "Savollar, to‘g‘ri javoblar va izohlar bilan.",
      url: `/biletlar/${ticketId}`,
      type: "article",
      locale: "uz_UZ"
    }
  };
}

export default async function BiletDetailPage({ params }: Params) {
  const { ticketId } = await params;
  const lang = await getServerLanguage();
  const t = (key: string, vars?: Record<string, string | number>) => getTranslation(lang, key, vars);
  const { ticket, status } = await fetchPublicTicket(ticketId, lang);

  if (status === 403) {
    return (
      <PublicShell>
        <section className="view">
          <div className="card publicLocked">
            <div className="publicLockedIcon">
              <Lock className="lucide" aria-hidden="true" />
            </div>
            <h1 className="publicH1">{t("tickets.lockedTitle")}</h1>
            <p className="publicLead">
              {t("tickets.lockedText")} —{" "}
              <Link href="/biletlar" className="publicInlineLink">
                {t("footer.tickets")}
              </Link>
              .
            </p>
            <RegisterCta />
          </div>
        </section>
      </PublicShell>
    );
  }

  if (!ticket) notFound();

  const faqJsonLd = buildFaqJsonLd(ticket.questions.filter((question): question is NonNullable<(typeof ticket.questions)[number]> => Boolean(question)));
  const breadcrumbJsonLd = buildBreadcrumbJsonLd([
    { name: t("common.back"), url: "/" },
    { name: t("footer.tickets"), url: "/biletlar" },
    { name: ticket.title, url: `/biletlar/${ticket.id}` }
  ]);

  return (
    <PublicShell>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }} />
      <PublicTestRunner title={ticket.title} questions={ticket.questions} backHref="/biletlar" backLabel={t("footer.tickets")} />
      <RegisterCta />
    </PublicShell>
  );
}
