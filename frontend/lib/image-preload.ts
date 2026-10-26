import { getImageVariants, isCacheableQuestionImageUrl, QUESTION_IMAGE_SIZES, resolveQuestionImage } from "./question-image";

// Small concurrency-capped preload queue (Image() so'rovlari). Service worker (public/sw.js)
// isCacheableQuestionImageUrl'ga mos kelgan hamma narsani shaffof ushlab keshlaydi.
// Not a general-purpose queue: intentionally kept minimal for this one use case.
const CONCURRENCY_LIMIT = 3;
const preloadedUrls = new Set<string>();
let activeCount = 0;
const queue: string[] = [];

function pump() {
  while (activeCount < CONCURRENCY_LIMIT && queue.length > 0) {
    const url = queue.shift();
    if (!url) continue;
    activeCount += 1;
    // fetch() emas, Image(): R2 rasmlari CORS sarlavhasiz beriladi, shuning uchun fetch() brauzerda
    // bloklanardi va oldindan yuklash umuman ishlamasdi. <img> so'rovi CORS talab qilmaydi, rasm
    // brauzer keshiga tushadi va service worker (sw.js) uni ham keshlaydi.
    const image = new Image();
    image.decoding = "async";
    const done = () => {
      image.onload = null;
      image.onerror = null;
      activeCount -= 1;
      pump();
    };
    image.onload = done;
    image.onerror = done;
    // <ResponsiveImage> bilan bir xil srcset/sizes: brauzer shu ekranga mos aynan o'sha variantni
    // tanlaydi (kichik ekranga kichik fayl), keyin sahifa uni keshdan oladi.
    const variants = getImageVariants(url);
    if (variants) {
      image.sizes = QUESTION_IMAGE_SIZES;
      image.srcset = variants.srcSet;
      image.src = variants.m;
    } else {
      image.src = url;
    }
  }
}

// Sekin yoki "trafik tejash" rejimidagi tarmoqda butun bilet rasmlarini oldindan yuklamaymiz:
// ular hozir ko'rinayotgan savol rasmi bilan kanal uchun kurashib, uni sekinlashtirardi.
function isConstrainedConnection(): boolean {
  const connection = (navigator as any).connection;
  if (!connection) return false;
  if (connection.saveData) return true;
  return typeof connection.effectiveType === "string" && /(^|-)(2g|3g)$/.test(connection.effectiveType);
}

function enqueue(url: string, priority: boolean) {
  if (!url || preloadedUrls.has(url) || !isCacheableQuestionImageUrl(url)) return;
  preloadedUrls.add(url);
  if (priority) queue.unshift(url);
  else queue.push(url);
  pump();
}

const PRIORITY_AHEAD = 3; // hozirgidan keyingi shuncha rasm yuqori ustuvorlikda
const WINDOW_AHEAD = 10; // oldinga ko'pi bilan shuncha savol rasmi yuklanadi

// Savollar to'plamini bosqichma-bosqich yuklaydi: hozirgi savol rasmi va undan keyingi 10 tasi.
// Foydalanuvchi oldinga o'tganda (currentIndex o'zgarganda) oyna siljiydi va keyingi 10 tasi
// navbatga qo'shiladi — butun bilet/mavzu rasmlari bir yo'la yuklanmaydi (sekin internetda ular
// hozir ko'rinayotgan rasm bilan kanal uchun kurashardi). Sekin/trafik tejash tarmog'ida faqat
// eng yaqin 3 tasi yuklanadi.
export function preloadQuestionImages(
  questions: Array<{ image?: string | null } | null | undefined>,
  currentIndex: number
) {
  if (typeof window === "undefined" || !Array.isArray(questions) || !questions.length) return;

  const current = questions[currentIndex];
  if (current?.image) enqueue(resolveQuestionImage(current.image), true);

  const ahead = isConstrainedConnection() ? PRIORITY_AHEAD : WINDOW_AHEAD;
  for (let offset = 1; offset <= ahead; offset += 1) {
    const next = questions[currentIndex + offset];
    if (next?.image) enqueue(resolveQuestionImage(next.image), offset <= PRIORITY_AHEAD);
  }
}
