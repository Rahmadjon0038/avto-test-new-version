"use client";

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
  return (
    <div className={["progressStatsBlock", className].filter(Boolean).join(" ")}>
      <span className="progressStatsItem good">{`${correct} ta to‘g‘ri`}</span>
      <span className="progressStatsItem bad">{`${wrong} ta noto‘g‘ri`}</span>
      <span className="progressStatsItem muted">{`${unanswered} ta belgilanmagan`}</span>
    </div>
  );
}
