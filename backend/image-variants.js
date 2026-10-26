// Savol rasmlarini 3 o'lchamga bo'lish va siqish.
//
// Saqlash sxemasi (R2 bucket ichida):
//   images/<nom>.<ext>      — asl rasm (eski URL'lar shu yerga ishora qiladi, tegilmaydi;
//                             yangi yuklamalarda u siqilgan webp bo'ladi)
//   images/s/<nom>.webp     — kichik  (telefon)         480 px
//   images/m/<nom>.webp     — o'rtacha (planshet/noutbuk) 800 px
//   images/l/<nom>.webp     — katta   (keng ekran)     1280 px
//
// Variant URL'i asl URL'dan faqat nomi bo'yicha hosil qilinadi (frontend/lib/question-image.ts
// da xuddi shu qoida), shuning uchun bazadagi `image` maydonlarini o'zgartirish shart emas.
const sharp = require("sharp");
const {
  DeleteObjectsCommand,
  PutObjectCommand
} = require("@aws-sdk/client-s3");

const IMAGE_PREFIX = "images";
const VARIANTS = [
  { name: "s", width: 480, quality: 72 },
  { name: "m", width: 800, quality: 76 },
  { name: "l", width: 1280, quality: 80 }
];
// Yangi yuklangan asl nusxa ham siqiladi (zoom oynasi va eski mijozlar uchun).
const ORIGINAL_MAX_WIDTH = 1600;
const ORIGINAL_QUALITY = 82;
// Kalitda tasodifiy nom bor va hech qachon qayta yozilmaydi — brauzer/CDN'da cheksiz saqlash xavfsiz.
const CACHE_CONTROL = "public, max-age=31536000, immutable";

// "images/1784721784106-ho10047p.webp" -> { base: "1784721784106-ho10047p", ext: "webp" }
// Faqat to'g'ridan-to'g'ri images/ ichidagi fayllar (images/s/... kabi variantlar emas) asl hisoblanadi.
function parseOriginalKey(key) {
  const match = /^images\/([^/]+)\.(jpe?g|png|webp|avif)$/i.exec(String(key || ""));
  return match ? { base: match[1], ext: match[2].toLowerCase() } : null;
}

function variantKey(key, variantName) {
  const parsed = parseOriginalKey(key);
  if (!parsed) return null;
  return `${IMAGE_PREFIX}/${variantName}/${parsed.base}.webp`;
}

function allVariantKeys(key) {
  return VARIANTS.map((variant) => variantKey(key, variant.name)).filter(Boolean);
}

function openImage(buffer) {
  // rotate(): telefon kamerasidagi EXIF burilishini qo'llaydi, aks holda rasm yonboshlab qolardi.
  return sharp(buffer, { failOn: "none" }).rotate();
}

async function renderWebp(buffer, width, quality) {
  const { data, info } = await openImage(buffer)
    .resize({ width, withoutEnlargement: true })
    .webp({ quality, effort: 4 })
    .toBuffer({ resolveWithObject: true });
  return { buffer: data, width: info.width, height: info.height };
}

// Asl rasmdan 3 ta variant (buffer + o'lcham) yaratadi. Kichik rasm kattalashtirilmaydi.
async function createVariants(buffer) {
  const rendered = await Promise.all(VARIANTS.map((variant) => renderWebp(buffer, variant.width, variant.quality)));
  return VARIANTS.map((variant, index) => ({ ...variant, ...rendered[index] }));
}

// Yangi yuklangan asl nusxani siqadi (webp, eng ko'pi bilan 1600 px).
async function compressOriginal(buffer) {
  return renderWebp(buffer, ORIGINAL_MAX_WIDTH, ORIGINAL_QUALITY);
}

function putWebp(s3, bucket, key, body) {
  return s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: "image/webp",
      CacheControl: CACHE_CONTROL
    })
  );
}

// `originalKey` uchun 3 ta variantni yuklaydi. Qaytaradi: [{ name, key, bytes, width }]
async function uploadVariants({ s3, bucket, originalKey, buffer }) {
  const variants = await createVariants(buffer);
  await Promise.all(
    variants.map((variant) => putWebp(s3, bucket, variantKey(originalKey, variant.name), variant.buffer))
  );
  return variants.map((variant) => ({
    name: variant.name,
    key: variantKey(originalKey, variant.name),
    bytes: variant.buffer.length,
    width: variant.width
  }));
}

// Asl rasm o'chirilganda uning variantlari ham o'chiriladi (yetim fayllar qolmasin).
async function deleteVariants({ s3, bucket, originalKey }) {
  const keys = allVariantKeys(originalKey);
  if (!keys.length) return;
  await s3.send(
    new DeleteObjectsCommand({
      Bucket: bucket,
      Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true }
    })
  );
}

module.exports = {
  IMAGE_PREFIX,
  VARIANTS,
  ORIGINAL_MAX_WIDTH,
  CACHE_CONTROL,
  parseOriginalKey,
  variantKey,
  allVariantKeys,
  createVariants,
  compressOriginal,
  putWebp,
  uploadVariants,
  deleteVariants
};
