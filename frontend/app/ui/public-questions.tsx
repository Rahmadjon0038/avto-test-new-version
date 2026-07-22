import Link from "next/link";
import { ArrowRight, Sparkles } from "lucide-react";
import { resolveQuestionImage, type PublicQuestion } from "@/lib/server-api";
import { useSiteLanguage } from "@/app/site-language-provider";

export function RegisterCta({ text }: { text?: string }) {
  const { t } = useSiteLanguage();
  return (
    <div className="publicCta">
      <div className="publicCtaMain">
        <span className="publicCtaIcon" aria-hidden="true">
          <Sparkles className="lucide" />
        </span>
        <div className="publicCtaCopy">
          <div className="publicCtaTitle">{t("public.registerCtaTitle")}</div>
          <div className="publicCtaText">
            {text || t("public.registerCtaText")}
          </div>
        </div>
      </div>
      <Link href="/?auth=register" className="btn btn-primary publicCtaBtn">
        {t("public.registerCtaButton")} <ArrowRight className="lucide" aria-hidden="true" />
      </Link>
    </div>
  );
}

export function PublicQuestionList({ questions }: { questions: PublicQuestion[] }) {
  const { t } = useSiteLanguage();
  return (
    <div className="publicQuestionList">
      {questions.map((q, i) => {
        const hasImage = Boolean(String(q.image || "").trim());
        return (
          <article className="card publicQuestion" id={`savol-${i + 1}`} key={q.id || i}>
            <div className="qTitleBar">
              <span className="publicQNum">{i + 1}.</span> {q.text}
            </div>
            <div className="qLayout">
              <div className="qRight">
                <div className="options">
                  {q.options.map((opt, oi) => {
                    const correct = oi === q.correctIndex;
                    return (
                      <div className={`option publicOption ${correct ? "correct" : ""}`} key={oi}>
                        <span className="optionKey">F{oi + 1}</span>
                        <span className="optionText">{opt}</span>
                        {correct ? <span className="publicCorrectTag">{t("public.correctAnswer")}</span> : null}
                      </div>
                    );
                  })}
                </div>
                {q.explanation ? (
                  <div className="explanation">
                    <div className="explanationLabel">{t("public.explanation")}</div>
                    <div className="publicExplanationText">{q.explanation}</div>
                  </div>
                ) : null}
              </div>
              {hasImage ? (
                <div className="qLeft">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img className="qimg" src={resolveQuestionImage(q.image)} alt={`${i + 1}-savol rasmi`} loading="lazy" />
                </div>
              ) : null}
            </div>
          </article>
        );
      })}
    </div>
  );
}

export function buildFaqJsonLd(questions: PublicQuestion[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: questions.slice(0, 50).map((q) => ({
      "@type": "Question",
      name: q.text,
      acceptedAnswer: {
        "@type": "Answer",
        text: [q.options[q.correctIndex], q.explanation].filter(Boolean).join(" — ")
      }
    }))
  };
}

export function buildBreadcrumbJsonLd(items: { name: string; url: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: item.url
    }))
  };
}

export function buildItemListJsonLd(name: string, items: { name: string; url?: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name,
    numberOfItems: items.length,
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      ...(item.url ? { url: item.url } : {})
    }))
  };
}
