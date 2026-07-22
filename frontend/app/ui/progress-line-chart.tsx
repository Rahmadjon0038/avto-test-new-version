"use client";

import { useSiteLanguage } from "@/app/site-language-provider";

type ProgressLineChartProps = {
  correct: number;
  wrong: number;
  unanswered: number;
  title?: string;
  emptyText?: string;
  className?: string;
};

export default function ProgressLineChart({
  correct,
  wrong,
  unanswered,
  title = "Progres",
  emptyText = "Natija hali yo‘q",
  className
}: ProgressLineChartProps) {
  const { t } = useSiteLanguage();
  const total = Math.max(correct + wrong + unanswered, 0);
  const correctPercent = total > 0 ? Math.round((correct / total) * 100) : 0;
  const wrongPercent = total > 0 ? Math.round((wrong / total) * 100) : 0;
  const unansweredPercent = total > 0 ? Math.round((unanswered / total) * 100) : 0;

  return (
    <div className={["progressLineCard", className].filter(Boolean).join(" ")}>
      <div className="progressLineHeader">
        <div>
          <div className="progressLineValue">{correctPercent}%</div>
          <div className="progressLineTitle">{title === "Progres" ? t("progress.title") : title}</div>
        </div>
        <div className="progressLineMeta">{total > 0 ? `${correct}/${total}` : emptyText === "Natija hali yo‘q" ? t("progress.empty") : emptyText}</div>
      </div>

      <div className="progressLineChartArea">
        {total > 0 ? (
          <div className="progressLineTrack" aria-hidden="true">
            <div className="progressLineFill" style={{ width: `${correctPercent}%` }} />
            <div className="progressLineMarker" style={{ left: `${correctPercent}%` }} />
          </div>
        ) : (
          <div className="progressLineEmpty">{emptyText}</div>
        )}
      </div>

      <div className="progressLineLegend">
        <span className="progressLineLegendItem good">{correctPercent}% {t("progress.correct", { count: "" }).replace(/^ /, "").replace("{count}", "")}</span>
        <span className="progressLineLegendItem bad">{wrongPercent}% {t("progress.wrong", { count: "" }).replace(/^ /, "").replace("{count}", "")}</span>
        <span className="progressLineLegendItem muted">{unansweredPercent}% {t("progress.unanswered", { count: "" }).replace(/^ /, "").replace("{count}", "")}</span>
      </div>
    </div>
  );
}
