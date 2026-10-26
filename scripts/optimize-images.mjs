// R2 dagi mavjud savol rasmlarini 3 o'lchamga (s=480, m=800, l=1280 px, webp) bo'ladi.
//
//   node scripts/optimize-images.mjs                 # DRY-RUN: faqat nimalar qilinishini ko'rsatadi
//   node scripts/optimize-images.mjs --apply         # haqiqatan yaratadi va yuklaydi
//   node scripts/optimize-images.mjs --apply --limit=20        # sinov uchun dastlabki 20 tasi
//   node scripts/optimize-images.mjs --apply --fix-cache-headers   # asl fayllarga ham uzoq kesh sarlavhasi
//   node scripts/optimize-images.mjs --apply --force           # tayyor variantlarni ham qayta yaratadi
//
// Asl rasmlar o'chirilmaydi/almashtirilmaydi, qayta ishga tushirish xavfsiz (faqat yetishmaganini yaratadi).
// Odatda server'da: ./scripts/optimize-images.sh --apply
import { createRequire } from "module";
import path from "path";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
require("dotenv").config({ path: path.join(here, "..", ".env") });

const { S3Client } = require("@aws-sdk/client-s3");
const { migrate } = require("../backend/image-migration.js");

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name, fallback) => {
  const found = args.find((arg) => arg.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : fallback;
};

const bucket = process.env.R2_BUCKET_NAME;
if (!bucket || !process.env.R2_ENDPOINT || !process.env.R2_ACCESS_KEY_ID || !process.env.R2_SECRET_ACCESS_KEY) {
  console.error("R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY va R2_BUCKET_NAME .env da to'ldirilgan bo'lishi kerak.");
  process.exit(1);
}

const s3 = new S3Client({
  region: "auto",
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY
  }
});

const limit = Number(option("limit", "")) || Infinity;
const concurrency = Number(option("concurrency", "4")) || 4;

const started = Date.now();
const stats = await migrate({
  s3,
  bucket,
  apply: flag("apply"),
  force: flag("force"),
  fixCacheHeaders: flag("fix-cache-headers"),
  limit,
  concurrency,
  log: (line) => console.log(line)
});

const mb = (bytes) => (bytes / 1024 / 1024).toFixed(1);
console.log("\n--- Natija ---");
console.log(`Asl rasmlar: ${stats.originals}, oldin tayyor: ${stats.alreadyDone}, qayta ishlangan: ${stats.processed}, xato: ${stats.failed}`);
if (stats.processed > 0) {
  const total = stats.variantBytes.s + stats.variantBytes.m + stats.variantBytes.l;
  console.log(`Asl hajm: ${mb(stats.originalBytes)} MB`);
  console.log(
    `Variantlar: s=${mb(stats.variantBytes.s)} MB, m=${mb(stats.variantBytes.m)} MB, l=${mb(stats.variantBytes.l)} MB (jami ${mb(total)} MB)`
  );
  console.log(
    `Telefon (s) bitta rasm uchun o'rtacha ${(stats.variantBytes.s / stats.processed / 1024).toFixed(0)} KB, ` +
      `asl ${(stats.originalBytes / stats.processed / 1024).toFixed(0)} KB edi`
  );
}
if (stats.failures.length) {
  console.log("\nXatolar:");
  for (const failure of stats.failures) console.log(` - ${failure.key}: ${failure.error}`);
}
console.log(`Vaqt: ${((Date.now() - started) / 1000).toFixed(1)} s`);
process.exit(stats.failed > 0 ? 2 : 0);
