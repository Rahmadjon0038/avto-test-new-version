// Canonical question-image URL resolver, consolidated from the ~10 near-identical copies that
// used to live in individual pages. Question images are Cloudflare R2 URLs in the common case
// (served as-is); anything else routes through the backend's `/api/image?u=` proxy.
export function resolveQuestionImage(image?: string | null, fallback: string = "/default.png"): string {
  const value = String(image || "").trim();
  if (!value) return fallback;
  if (value.startsWith("/")) return value;
  if (/^https?:\/\//i.test(value)) {
    try {
      const parsed = new URL(value);
      if (parsed.hostname.endsWith("r2.dev") || parsed.hostname.endsWith("r2.cloudflarestorage.com")) {
        return value;
      }
    } catch {
      // fall through to proxy
    }
    return `/api/image?u=${encodeURIComponent(value)}`;
  }
  return value;
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
    if (parsed.hostname.endsWith("r2.dev") || parsed.hostname.endsWith("r2.cloudflarestorage.com")) return true;
    if (parsed.pathname === "/api/image" && parsed.searchParams.has("u")) return true;
    return false;
  } catch {
    return false;
  }
}
