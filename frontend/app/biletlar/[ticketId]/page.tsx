import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Lock } from "lucide-react";
import { siteName } from "@/lib/site";
import { fetchPublicTicket } from "@/lib/server-api";
import PublicShell from "@/app/ui/public-shell";
import PublicTestRunner from "@/app/ui/public-test-runner";
import { RegisterCta, buildFaqJsonLd, buildBreadcrumbJsonLd } from "@/app/ui/public-questions";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ ticketId: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { ticketId } = await params;
  const { ticket } = await fetchPublicTicket(ticketId);
  const title = ticket ? `${ticket.title} — savol va javoblar` : "Bilet";
  return {
    title,
    description: ticket
      ? `${ticket.title}: ${ticket.questions.length} ta savol, to‘g‘ri javoblar va izohlar bilan. Avto imtihonga bepul tayyorlaning.`
      : "Haydovchilik bileti — savol va javoblar.",
    alternates: { canonical: `/biletlar/${ticketId}` },
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
  const { ticket, status } = await fetchPublicTicket(ticketId);

  if (status === 403) {
    return (
      <PublicShell>
        <section className="view">
          <div className="card publicLocked">
            <div className="publicLockedIcon">
              <Lock className="lucide" aria-hidden="true" />
            </div>
            <h1 className="publicH1">Bu bilet yopiq</h1>
            <p className="publicLead">
              Bu bilet faqat ro‘yxatdan o‘tgan foydalanuvchilar uchun. Birinchi biletlar bepul ochiq —{" "}
              <Link href="/biletlar" className="publicInlineLink">
                bepul biletlarni ko‘rish
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

  const faqJsonLd = buildFaqJsonLd(ticket.questions);
  const breadcrumbJsonLd = buildBreadcrumbJsonLd([
    { name: "Bosh sahifa", url: "/" },
    { name: "Biletlar", url: "/biletlar" },
    { name: ticket.title, url: `/biletlar/${ticket.id}` }
  ]);

  return (
    <PublicShell>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }} />
      <PublicTestRunner title={ticket.title} questions={ticket.questions} backHref="/biletlar" backLabel="Biletlar" />
      <RegisterCta />
    </PublicShell>
  );
}
