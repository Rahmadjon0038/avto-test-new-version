// Caches question images (Cloudflare R2 + the /api/image proxy) so repeat test attempts don't
// re-hit the CDN. Everything else — API calls, audio, video, HTML navigation — passes through
// untouched. This mirrors the classifier in lib/question-image.ts's isCacheableQuestionImageUrl;
// service worker scripts can't import Next bundles, so it's intentionally duplicated here once.
const CACHE_NAME = "topshirdi-question-images-v1";
const CACHE_PREFIX = "topshirdi-question-images-";
const FALLBACK_IMAGE = "/default.png";

// Ilova qobig'i (JS/CSS/shrift/HTML) uchun alohida kesh: sekin internetda ham sahifa darhol
// ochilsin. `_next/static/*` fayllari nomida hash bor (o'zgarmas) — cache-first. `/app` sahifalari
// HTML'i esa stale-while-revalidate: keshdan zumda beriladi, orqada yangilanadi.
const SHELL_CACHE = "topshirdi-shell-v1";
const SHELL_PREFIX = "topshirdi-shell-";

function isStaticAssetRequest(request) {
  if (request.method !== "GET") return false;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return false;
  return url.pathname.startsWith("/_next/static/") || url.pathname === "/way.webp" || url.pathname === "/default.png";
}

function isAppNavigation(request) {
  if (request.method !== "GET" || request.mode !== "navigate") return false;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return false;
  return url.pathname === "/app" || url.pathname.startsWith("/app/");
}

async function cacheFirst(request) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

async function staleWhileRevalidate(event) {
  const { request } = event;
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((response) => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);
  if (cached) {
    event.waitUntil(network);
    return cached;
  }
  return (await network) || Response.error();
}

function isCacheableImageRequest(request) {
  if (request.method !== "GET") return false;
  let url;
  try {
    url = new URL(request.url);
  } catch {
    return false;
  }
  if (url.hostname.endsWith("r2.dev") || url.hostname.endsWith("r2.cloudflarestorage.com")) return true;
  // O'z domeni orqali berilgan R2 (masalan cdn.topshirdi.uz): boshqa saytdan keladigan
  // /images/<nom>.<ext> va /images/s|m|l/<nom>.webp so'rovlari ham rasm hisoblanadi.
  if (url.origin !== self.location.origin && /^\/images\/(?:[sml]\/)?[^/]+\.(?:jpe?g|png|webp|avif)$/i.test(url.pathname)) return true;
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
        keys
          .filter(
            (key) =>
              (key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME) || (key.startsWith(SHELL_PREFIX) && key !== SHELL_CACHE)
          )
          .map((key) => caches.delete(key))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  if (isStaticAssetRequest(request)) {
    event.respondWith(cacheFirst(request));
    return;
  }
  if (isAppNavigation(request)) {
    event.respondWith(staleWhileRevalidate(event));
    return;
  }

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
