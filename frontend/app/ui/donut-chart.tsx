// recharts (~280 KB) faqat shu bitta donut uchun yuklanardi. Bu yerda esa bir necha satrlik SVG:
// natija oynasi bir zumda chiziladi va test sahifalari bundle'dan shuncha yengillashadi.
type DonutChartProps = {
  // [to'g'ri, qolgan] — birinchi qiymat ko'k yoy sifatida chiziladi.
  data: Array<{ value: number }>;
  size?: number;
};

const SIZE = 220;
const STROKE = 24;
const RADIUS = 84; // ichki 72 va tashqi 96 radiuslarning o'rtasi (avvalgi recharts o'lchamlari)

export default function DonutChart({ data, size = SIZE }: DonutChartProps) {
  const correct = Math.max(Number(data?.[0]?.value) || 0, 0);
  const rest = Math.max(Number(data?.[1]?.value) || 0, 0);
  const total = correct + rest;
  const fraction = total > 0 ? Math.min(correct / total, 1) : 0;
  const circumference = 2 * Math.PI * RADIUS;
  const arc = circumference * fraction;
  const isFull = fraction >= 1;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${SIZE} ${SIZE}`} role="presentation" focusable="false">
      <circle cx={SIZE / 2} cy={SIZE / 2} r={RADIUS} fill="none" stroke="rgba(255, 255, 255, 0.09)" strokeWidth={STROKE} />
      {fraction > 0 ? (
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          fill="none"
          stroke="#2f6dff"
          strokeWidth={STROKE}
          strokeLinecap={isFull ? "butt" : "round"}
          strokeDasharray={`${arc} ${circumference}`}
          transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
        />
      ) : null}
    </svg>
  );
}
