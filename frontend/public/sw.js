// Caches question images (Cloudflare R2 + the /api/image proxy) so repeat test attempts don't
// re-hit the CDN. Everything else — API calls, audio, video, HTML navigation — passes through
// untouched. This mirrors the classifier in lib/question-image.ts's isCacheableQuestionImageUrl;
// service worker scripts can't import Next bundles, so it's intentionally duplicated here once.
const CACHE_NAME = "topshirdi-question-images-v1";
const CACHE_PREFIX = "topshirdi-question-images-";
const FALLBACK_IMAGE = "/default.png";

function isCacheableImageRequest(request) {
  if (request.method !== "GET") return false;
  let url;
  try {
    url = new URL(request.url);
  } catch {
    return false;
  }
  if (url.hostname.endsWith("r2.dev") || url.hostname.endsWith("r2.cloudflarestorage.com")) return true;
  if (url.pathname === "/api/image" && url.searchParams.has("u")) return true;
  return false;
}

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map((key) => caches.delete(key))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (!isCacheableImageRequest(request)) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(request);
      if (cached) return cached;

      try {
        const response = await fetch(request);
        // Cross-origin R2 requests made without a `crossorigin` attribute come back opaque
        // (status 0, ok: false) even on success — that's expected and still safe to cache.
        const isSameOrigin = new URL(request.url).origin === self.location.origin;
        if (!isSameOrigin || response.ok) {
          cache.put(request, response.clone());
        }
        return response;
      } catch {
        const fallback = await cache.match(FALLBACK_IMAGE);
        if (fallback) return fallback;
        return Response.error();
      }
    })()
  );
});
