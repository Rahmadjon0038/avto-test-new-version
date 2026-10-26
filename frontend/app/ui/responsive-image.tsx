"use client";

import { useEffect, useMemo, useState, type ImgHTMLAttributes } from "react";
import { getImageVariants, QUESTION_IMAGE_SIZES } from "@/lib/question-image";

type ResponsiveImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "src" | "srcSet" | "onError"> & {
  // resolveQuestionImage() natijasi (asl rasm URL'i).
  src: string;
  fallbackSrc?: string;
  // Hamma urinish muvaffaqiyatsiz bo'lib, zaxira rasm ko'rsatilganda chaqiriladi.
  onFallback?: () => void;
};

// Ekran o'lchamiga mos variantni (s/m/l) brauzer o'zi tanlaydi (srcset + sizes). Variant hali
// yaratilmagan (migratsiya ishlamagan) bo'lsa 404 keladi — shunda asl rasmga, u ham bo'lmasa
// zaxira rasmga o'tadi, ya'ni migratsiyadan oldin ham hech narsa buzilmaydi.
export default function ResponsiveImage({
  src,
  sizes = QUESTION_IMAGE_SIZES,
  fallbackSrc = "/default.png",
  onFallback,
  alt = "",
  ...rest
}: ResponsiveImageProps) {
  const variants = useMemo(() => getImageVariants(src), [src]);
  // 0 — srcset (variantlar), 1 — asl rasm, 2 — zaxira rasm
  const [stage, setStage] = useState<0 | 1 | 2>(0);

  useEffect(() => {
    setStage(0);
  }, [src]);

  const useVariants = Boolean(variants) && stage === 0;
  const currentSrc = stage === 2 ? fallbackSrc : useVariants ? variants!.m : src;

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      {...rest}
      alt={alt}
      src={currentSrc}
      srcSet={useVariants ? variants!.srcSet : undefined}
      sizes={useVariants ? sizes : undefined}
      onError={() => {
        if (stage === 0 && variants) {
          setStage(1);
        } else if (stage < 2 && src !== fallbackSrc) {
          setStage(2);
          onFallback?.();
        } else {
          onFallback?.();
        }
      }}
    />
  );
}
