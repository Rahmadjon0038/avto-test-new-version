"use client";

import { usePathname, useRouter } from "next/navigation";
import { ArrowRight, Sparkles } from "lucide-react";
import { resolveQuestionImage, type PublicQuestion } from "@/lib/server-api";
import { useSiteLanguage } from "@/app/site-language-provider";
import ResponsiveImage from "@/app/ui/responsive-image";

export function RegisterCta({ text }: { text?: string }) {
  const { t } = useSiteLanguage();
  const router = useRouter();
  const pathname = usePathname();

  function openRegister() {
    const url = new URL(window.location.href);
    url.searchParams.set("auth", "register");
    router.replace(`${pathname}?${url.searchParams.toString()}`, { scroll: false });
  }

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
      <button type="button" className="btn btn-primary publicCtaBtn" onClick={openRegister}>
        {t("public.registerCtaButton")} <ArrowRight className="lucide" aria-hidden="true" />
      </button>
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
                  <ResponsiveImage className="qimg" src={resolveQuestionImage(q.image)} alt={`${i + 1}-savol rasmi`} loading="lazy" decoding="async" />
                </div>
              ) : null}
            </div>
          </article>
        );
      })}
    </div>
  );
}
