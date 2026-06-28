import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Lock } from "lucide-react";
import { siteName } from "@/lib/site";
import { fetchPublicTopic } from "@/lib/server-api";
import PublicShell from "@/app/ui/public-shell";
import PublicTestRunner from "@/app/ui/public-test-runner";
import { RegisterCta, buildFaqJsonLd, buildBreadcrumbJsonLd } from "@/app/ui/public-questions";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ topicId: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { topicId } = await params;
  const { topic, status } = await fetchPublicTopic(topicId);
  const title = topic ? `${topic.title} — testlar va javoblar` : "Mavzu";
  return {
    title,
    description: topic
      ? `${topic.title}: ${topic.questions.length} ta savol, to‘g‘ri javoblar va izohlar bilan. Bepul mashq qiling.`
      : "Mavzu bo‘yicha testlar — savol va javoblar.",
    alternates: { canonical: `/mavzular/${topicId}` },
    robots: status === 403 ? { index: false, follow: true } : undefined,
    openGraph: {
      title: `${title} | ${siteName}`,
      description: "Savollar, to‘g‘ri javoblar va izohlar bilan.",
      url: `/mavzular/${topicId}`,
      type: "article",
      locale: "uz_UZ"
    }
  };
}

export default async function MavzuDetailPage({ params }: Params) {
  const { topicId } = await params;
  const { topic, status } = await fetchPublicTopic(topicId);

  if (status === 403) {
    return (
      <PublicShell>
        <section className="view">
          <div className="card publicLocked">
            <div className="publicLockedIcon">
              <Lock className="lucide" aria-hidden="true" />
            </div>
            <h1 className="publicH1">Bu mavzu yopiq</h1>
            <p className="publicLead">
              Bu mavzu faqat ro‘yxatdan o‘tgan foydalanuvchilar uchun. Birinchi mavzu bepul ochiq —{" "}
              <Link href="/mavzular" className="publicInlineLink">
                bepul mavzuni ko‘rish
              </Link>
              .
            </p>
            <RegisterCta />
          </div>
        </section>
      </PublicShell>
    );
  }

  if (!topic) notFound();

  const faqJsonLd = buildFaqJsonLd(topic.questions);
  const breadcrumbJsonLd = buildBreadcrumbJsonLd([
    { name: "Bosh sahifa", url: "/" },
    { name: "Mavzular", url: "/mavzular" },
    { name: topic.title, url: `/mavzular/${topic.id}` }
  ]);

  return (
    <PublicShell>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }} />
      <PublicTestRunner title={topic.title} questions={topic.questions} backHref="/mavzular" backLabel="Mavzular" />
      <RegisterCta />
    </PublicShell>
  );
}
