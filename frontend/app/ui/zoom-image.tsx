"use client";

import { useEffect, useState, type MouseEventHandler } from "react";
import ResponsiveImage from "@/app/ui/responsive-image";

// To'liq ekran (zoom) rasmi. Sahifada allaqachon yuklangan o'rtacha (m) variant darhol ko'rinadi,
// uning ustiga katta (l, 1280 px) variant yuklanib, tayyor bo'lgach silliq almashadi — foydalanuvchi
// bo'sh ekran yoki loader kutmaydi, sekin internetda ham rasm zumda ochiladi.
export default function ZoomImage({
  src,
  alt,
  onClick
}: {
  src: string;
  alt?: string;
  onClick?: MouseEventHandler<HTMLElement>;
}) {
  const [largeReady, setLargeReady] = useState(false);

  useEffect(() => {
    setLargeReady(false);
  }, [src]);

  return (
    <span className="zoomImageStack" onClick={onClick}>
      <ResponsiveImage className="imageLightboxImg" src={src} variant="m" alt={alt} decoding="async" />
      <ResponsiveImage
        className={`imageLightboxImg zoomImageTop ${largeReady ? "isReady" : ""}`}
        src={src}
        variant="l"
        alt=""
        aria-hidden="true"
        decoding="async"
        fetchPriority="high"
        onLoad={() => setLargeReady(true)}
      />
    </span>
  );
}
