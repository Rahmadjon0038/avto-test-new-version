"use client";

import { useMemo } from "react";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis } from "recharts";

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
  const total = Math.max(correct + wrong + unanswered, 0);
  const correctPercent = total > 0 ? Math.round((correct / total) * 100) : 0;
  const wrongPercent = total > 0 ? Math.round((wrong / total) * 100) : 0;
  const unansweredPercent = total > 0 ? Math.round((unanswered / total) * 100) : 0;

  const data = useMemo(
    () => [
      { label: "To‘g‘ri", value: correctPercent },
      { label: "Xato", value: wrongPercent },
      { label: "Bo‘sh", value: unansweredPercent }
    ],
    [correctPercent, unansweredPercent, wrongPercent]
  );

  return (
    <div className={["progressLineCard", className].filter(Boolean).join(" ")}>
      <div className="progressLineHeader">
        <div>
          <div className="progressLineValue">{correctPercent}%</div>
          <div className="progressLineTitle">{title}</div>
        </div>
        <div className="progressLineMeta">{total > 0 ? `${correct}/${total}` : emptyText}</div>
      </div>

      <div className="progressLineChartArea">
        {total > 0 ? (
          <ResponsiveContainer width="100%" height={72}>
            <LineChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
              <XAxis dataKey="label" hide />
              <YAxis hide domain={[0, 100]} />
              <Line
                type="monotone"
                dataKey="value"
                stroke="var(--primary)"
                strokeWidth={2.6}
                dot={{ r: 3, strokeWidth: 2, fill: "var(--panel)" }}
                activeDot={{ r: 4 }}
              />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div className="progressLineEmpty">{emptyText}</div>
        )}
      </div>

      <div className="progressLineLegend">
        <span className="progressLineLegendItem good">{correctPercent}% to‘g‘ri</span>
        <span className="progressLineLegendItem bad">{wrongPercent}% xato</span>
        <span className="progressLineLegendItem muted">{unansweredPercent}% bo‘sh</span>
      </div>
    </div>
  );
}
