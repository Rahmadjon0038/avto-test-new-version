"use client";

import { useSiteLanguage } from "@/app/site-language-provider";

type ProgressStatsBlockProps = {
  correct: number;
  wrong: number;
  unanswered: number;
  className?: string;
};

export default function ProgressStatsBlock({
  correct,
  wrong,
  unanswered,
  className
}: ProgressStatsBlockProps) {
  const { t } = useSiteLanguage();
  return (
    <div className={["progressStatsBlock", className].filter(Boolean).join(" ")}>
      <span className="progressStatsItem good">{t("progress.correct", { count: correct })}</span>
      <span className="progressStatsItem bad">{t("progress.wrong", { count: wrong })}</span>
      <span className="progressStatsItem muted">{t("progress.unanswered", { count: unanswered })}</span>
    </div>
  );
}
