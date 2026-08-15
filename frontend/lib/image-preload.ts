import { isCacheableQuestionImageUrl, resolveQuestionImage } from "./question-image";

// Small concurrency-capped fetch queue. Plain fetch() calls are enough — the service worker
// (public/sw.js) transparently intercepts and caches anything matching isCacheableQuestionImageUrl.
// Not a general-purpose queue: intentionally kept minimal for this one use case.
const CONCURRENCY_LIMIT = 6;
const preloadedUrls = new Set<string>();
let activeCount = 0;
const queue: string[] = [];

function pump() {
  while (activeCount < CONCURRENCY_LIMIT && queue.length > 0) {
    const url = queue.shift();
    if (!url) continue;
    activeCount += 1;
    fetch(url, { credentials: "omit" })
      .catch(() => {
        // Best effort — a failed preload just means it'll load normally when rendered.
      })
      .finally(() => {
        activeCount -= 1;
        pump();
      });
  }
}

function enqueue(url: string, priority: boolean) {
  if (!url || preloadedUrls.has(url) || !isCacheableQuestionImageUrl(url)) return;
  preloadedUrls.add(url);
  if (priority) queue.unshift(url);
  else queue.push(url);
  pump();
}

// Preloads the current question's image at high priority, then the next few at lower priority,
// so the very first render never waits on a full-set image fetch.
export function preloadQuestionImages(
  questions: Array<{ image?: string | null } | null | undefined>,
  currentIndex: number,
  aheadCount = 3
) {
  if (typeof window === "undefined" || !Array.isArray(questions) || !questions.length) return;

  const current = questions[currentIndex];
  if (current?.image) enqueue(resolveQuestionImage(current.image), true);

  for (let offset = 1; offset <= aheadCount; offset += 1) {
    const next = questions[currentIndex + offset];
    if (next?.image) enqueue(resolveQuestionImage(next.image), true);
  }

  for (let index = 0; index < questions.length; index += 1) {
    if (index >= currentIndex && index <= currentIndex + aheadCount) continue;
    const question = questions[index];
    if (question?.image) enqueue(resolveQuestionImage(question.image), false);
  }
}
