"use client";

import { useEffect, useMemo, useState } from "react";
import { useSiteLanguage } from "@/app/site-language-provider";

// Biletni yoki imtihonni shuncha va undan ko'p to'g'ri javob bilan tugatgan foydalanuvchi tabriklanadi.
export const CELEBRATE_MIN_CORRECT = 18;

/** To'liq bo'lmagan biletlarda (20 tadan kam savol) shu foizga mos keladigan miqdor talab qilinadi. */
export function celebrationThreshold(total: number) {
  if (!Number.isFinite(total) || total <= 0) return CELEBRATE_MIN_CORRECT;
  return Math.min(CELEBRATE_MIN_CORRECT, Math.ceil(total * 0.9));
}

const COLORS = ["#ff5a5f", "#ffb400", "#22c55e", "#3b82f6", "#a855f7", "#f472b6", "#14b8a6", "#f97316"];

type Piece = { left: number; delay: number; duration: number; size: number; rotate: number; color: string; round: boolean };
type Shot = { side: "left" | "right"; delay: number; duration: number; dx: number; up: number; size: number; rotate: number; color: string; round: boolean };
type Balloon = { left: number; delay: number; duration: number; sway: number; color: string; scale: number };

const rand = (min: number, max: number) => min + Math.random() * (max - min);

// Bayramona kayfiyat: tabrik yozuvi (natija oynasi ichida) + butun ekran bo'ylab sochilayotgan rangli
// qog'ozlar (konfetti) va ko'tarilayotgan sharlar. Effektlar oynaning TASHQARISIDA (qo'shni element sifatida)
// chiziladi: oyna ichida `position: fixed` oyna o'lchamiga bog'lanib qolishi mumkin. Tashqi kutubxonasiz,
// faqat CSS animatsiya; "harakatni kamaytirish" yoqilgan qurilmalarda animatsiya ko'rsatilmaydi.
export function CelebrationBanner({ kind }: { kind: "ticket" | "exam" }) {
  const { t } = useSiteLanguage();
  return (
    <div className="celebrateBanner" role="status">
      <div className="celebrateTitle">{t("celebrate.title")}</div>
      <div className="celebrateText">{t(kind === "exam" ? "celebrate.examText" : "celebrate.ticketText")}</div>
    </div>
  );
}

export function CelebrationEffects() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const pieces = useMemo<Piece[]>(
    () =>
      Array.from({ length: 80 }, () => ({
        left: rand(0, 100),
        delay: rand(0, 1.6),
        duration: rand(3.2, 5.6),
        size: rand(7, 13),
        rotate: rand(240, 900),
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
        round: Math.random() < 0.3
      })),
    []
  );
  // Pastki ikki burchakdan tez otilib chiqadigan "to'p" konfettilari: ikki to'lqin, markazga qarab yoy bo'ylab uchadi.
  const shots = useMemo<Shot[]>(
    () =>
      (["left", "right"] as const).flatMap((side) =>
        Array.from({ length: 56 }, (_, index) => ({
          side,
          delay: (index < 28 ? 0 : 0.85) + rand(0, 0.18),
          duration: rand(1.7, 2.6),
          dx: rand(14, 62),
          up: rand(38, 88),
          size: rand(7, 12),
          rotate: rand(360, 1000),
          color: COLORS[Math.floor(Math.random() * COLORS.length)],
          round: Math.random() < 0.3
        }))
      ),
    []
  );
  const balloons = useMemo<Balloon[]>(
    () =>
      Array.from({ length: 10 }, (_, index) => ({
        left: 4 + index * 9.5 + rand(-3, 3),
        delay: rand(0, 1.8),
        duration: rand(6, 9),
        sway: rand(-30, 30),
        color: COLORS[(index * 3) % COLORS.length],
        scale: rand(0.85, 1.25)
      })),
    []
  );

  if (!mounted) return null;
  return (
    <div className="celebrateLayer" aria-hidden="true">
      {balloons.map((balloon, index) => (
        <span
          key={`b${index}`}
          className="celebrateBalloon"
          style={
            {
              left: `${balloon.left}%`,
              animationDelay: `${balloon.delay}s`,
              animationDuration: `${balloon.duration}s`,
              "--sway": `${balloon.sway}px`,
              "--balloon": balloon.color,
              "--scale": balloon.scale
            } as React.CSSProperties
          }
        />
      ))}
      {shots.map((shot, index) => (
        <span
          key={`s${index}`}
          className={`celebrateShot ${shot.side}`}
          style={
            {
              width: shot.size,
              height: shot.round ? shot.size : shot.size * 1.7,
              borderRadius: shot.round ? "50%" : 2,
              background: shot.color,
              animationDelay: `${shot.delay}s`,
              animationDuration: `${shot.duration}s`,
              "--dx": `${shot.side === "left" ? shot.dx : -shot.dx}vw`,
              "--up": `${-shot.up}vh`,
              "--rotate": `${shot.rotate}deg`
            } as React.CSSProperties
          }
        />
      ))}
      {pieces.map((piece, index) => (
        <span
          key={`c${index}`}
          className="celebrateConfetti"
          style={
            {
              left: `${piece.left}%`,
              width: piece.size,
              height: piece.round ? piece.size : piece.size * 1.7,
              borderRadius: piece.round ? "50%" : 2,
              background: piece.color,
              animationDelay: `${piece.delay}s`,
              animationDuration: `${piece.duration}s`,
              "--rotate": `${piece.rotate}deg`
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}
