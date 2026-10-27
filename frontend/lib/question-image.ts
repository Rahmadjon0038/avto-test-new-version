// Canonical question-image URL resolver, consolidated from the ~10 near-identical copies that
// used to live in individual pages. Question images are Cloudflare R2 URLs in the common case
// (served as-is); anything else routes through the backend's `/api/image?u=` proxy.
//
// R2 ni o'z domeniga (masalan cdn.topshirdi.uz) ulaganda shu domenni NEXT_PUBLIC_IMAGE_HOSTS
// (vergul bilan ajratilgan) ga yozing — rasmlar proksisiz, to'g'ridan-to'g'ri beriladi.
const EXTRA_IMAGE_HOSTS = String(process.env.NEXT_PUBLIC_IMAGE_HOSTS || "")
  .split(",")
  .map((host) => host.trim().toLowerCase())
  .filter(Boolean);

function isDirectImageHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host.endsWith("r2.dev") || host.endsWith("r2.cloudflarestorage.com") || EXTRA_IMAGE_HOSTS.includes(host);
}

export function resolveQuestionImage(image?: string | null, fallback: string = "/default.png"): string {
  const value = String(image || "").trim();
  if (!value) return fallback;
  if (value.startsWith("/")) return value;
  if (/^https?:\/\//i.test(value)) {
    try {
      const parsed = new URL(value);
      if (isDirectImageHost(parsed.hostname)) return value;
    } catch {
      // fall through to proxy
    }
    return `/api/image?u=${encodeURIComponent(value)}`;
  }
  return value;
}

// --- Responsive variantlar ---------------------------------------------------------------
// Backend (backend/image-variants.js) har bir rasm uchun 3 ta variant saqlaydi:
//   images/<nom>.<ext>  ->  images/s|m|l/<nom>.webp  (480 / 800 / 1280 px)
// Variant URL'i faqat nomdan hosil qilinadi, shuning uchun bazadagi `image` maydonlari o'zgarmaydi.
export const IMAGE_VARIANT_WIDTHS = { s: 480, m: 800, l: 1280 } as const;

// Savol rasmi keng ekranda 920 px gacha (CSS: .qimg max-width), undan tor ekranlarda deyarli to'liq
// kenglikda ko'rinadi. `sizes` rasmning "tabiiy" CSS kengligini ham belgilaydi, shuning uchun 920 bo'lishi shart:
// kichikroq yozilsa rasm keng ekranda ham shu kenglikda qolib, kichik ko'rinadi.
export const QUESTION_IMAGE_SIZES = "(max-width: 859px) calc(100vw - 32px), 920px";

export type ImageVariants = { s: string; m: string; l: string; srcSet: string };

export function getImageVariants(url?: string | null): ImageVariants | null {
  const value = String(url || "").trim();
  if (!/^https?:\/\//i.test(value)) return null;
  try {
    const parsed = new URL(value);
    if (!isDirectImageHost(parsed.hostname)) return null;
    const match = /^\/images\/([^/]+)\.(?:jpe?g|png|webp|avif)$/i.exec(parsed.pathname);
    if (!match) return null;
    const at = (name: "s" | "m" | "l") => `${parsed.origin}/images/${name}/${match[1]}.webp`;
    const variants = { s: at("s"), m: at("m"), l: at("l") };
    return {
      ...variants,
      srcSet: `${variants.s} ${IMAGE_VARIANT_WIDTHS.s}w, ${variants.m} ${IMAGE_VARIANT_WIDTHS.m}w, ${variants.l} ${IMAGE_VARIANT_WIDTHS.l}w`
    };
  } catch {
    return null;
  }
}

// Same R2-hostname / `/api/image` classification, used by the service worker (sw.js keeps its
// own copy since SW scripts can't import Next bundles) and the image preloader to decide what's
// safe to cache long-term in Cache Storage.
export function isCacheableQuestionImageUrl(url?: string | null): boolean {
  const value = String(url || "").trim();
  if (!value) return false;
  try {
    const base = typeof window !== "undefined" ? window.location.origin : "http://localhost";
    const parsed = new URL(value, base);
    if (isDirectImageHost(parsed.hostname)) return true;
    if (parsed.pathname === "/api/image" && parsed.searchParams.has("u")) return true;
    return false;
  } catch {
    return false;
  }
}
