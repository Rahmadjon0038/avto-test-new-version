// Qisqa sana ko'rinishi: "26.10.26 14:44" (Intl.DateTimeFormat "26.10.2026, 14:44" va uzun oy
// nomlari o'rniga). Qo'lda formatlash Intl obyekti yaratishdan ancha tez va ro'yxatlarda
// har qatorda chaqirilsa ham og'irlik qilmaydi.
const pad = (value: number) => String(value).padStart(2, "0");

export function formatShortDate(value: string | number | Date | null | undefined, withTime = true): string {
  if (value === null || value === undefined || value === "") return "—";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const day = `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${pad(date.getFullYear() % 100)}`;
  return withTime ? `${day} ${pad(date.getHours())}:${pad(date.getMinutes())}` : day;
}
