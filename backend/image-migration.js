// Mavjud (allaqachon R2 da turgan) rasmlar uchun bir martalik migratsiya: har bir asl rasmdan
// 3 ta variant (s/m/l) yaratib, shu bucket'ga yuklaydi. Asl rasmlarga tegmaydi (faqat ixtiyoriy
// `fixCacheHeaders` bilan kesh sarlavhasi qo'shiladi), shuning uchun bazadagi URL'lar va eski
// mijozlar (mobil ilova) buzilmaydi. Qayta ishga tushirsa — faqat yetishmayotganlarini yaratadi.
const {
  CopyObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command
} = require("@aws-sdk/client-s3");
const { CACHE_CONTROL, IMAGE_PREFIX, VARIANTS, parseOriginalKey, uploadVariants, variantKey } = require("./image-variants");

async function listAll(s3, bucket, prefix, delimiter) {
  const items = [];
  let token;
  do {
    const page = await s3.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        Delimiter: delimiter,
        ContinuationToken: token
      })
    );
    for (const object of page.Contents || []) items.push({ key: object.Key, size: Number(object.Size || 0) });
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  return items;
}

async function bodyToBuffer(body) {
  if (!body) return Buffer.alloc(0);
  if (Buffer.isBuffer(body)) return body;
  if (typeof body.transformToByteArray === "function") return Buffer.from(await body.transformToByteArray());
  const chunks = [];
  for await (const chunk of body) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

// Oddiy parallelizm chegarasi: bir vaqtda `limit` ta vazifa.
async function runPool(items, limit, worker) {
  let cursor = 0;
  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      await worker(items[index], index);
    }
  });
  await Promise.all(runners);
}

async function migrate({
  s3,
  bucket,
  apply = false,
  force = false,
  fixCacheHeaders = false,
  limit = Infinity,
  concurrency = 4,
  log = () => {}
}) {
  const originals = (await listAll(s3, bucket, `${IMAGE_PREFIX}/`, "/")).filter((item) => parseOriginalKey(item.key));

  // Mavjud variantlar bir marta ro'yxatdan olinadi (har rasm uchun alohida HEAD emas).
  const existing = new Set();
  for (const variant of VARIANTS) {
    for (const item of await listAll(s3, bucket, `${IMAGE_PREFIX}/${variant.name}/`)) existing.add(item.key);
  }

  const missing = originals.filter(
    (item) => force || VARIANTS.some((variant) => !existing.has(variantKey(item.key, variant.name)))
  );
  const queue = missing.slice(0, Number.isFinite(limit) ? limit : undefined);

  const stats = {
    originals: originals.length,
    alreadyDone: originals.length - missing.length,
    toProcess: queue.length,
    processed: 0,
    failed: 0,
    originalBytes: 0,
    variantBytes: { s: 0, m: 0, l: 0 },
    cacheHeadersFixed: 0,
    dryRun: !apply,
    failures: []
  };

  log(
    `Asl rasmlar: ${stats.originals}, tayyor: ${stats.alreadyDone}, qayta ishlanadi: ${stats.toProcess}` +
      (apply ? "" : "  (DRY-RUN: hech narsa yozilmaydi, --apply bilan ishga tushiring)")
  );

  if (!apply) return stats;

  await runPool(queue, concurrency, async (item, index) => {
    try {
      const object = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: item.key }));
      const buffer = await bodyToBuffer(object.Body);
      const uploaded = await uploadVariants({ s3, bucket, originalKey: item.key, buffer });
      stats.processed += 1;
      stats.originalBytes += buffer.length;
      for (const variant of uploaded) stats.variantBytes[variant.name] += variant.bytes;
      const kb = (bytes) => `${Math.round(bytes / 1024)}KB`;
      log(
        `[${index + 1}/${queue.length}] ${item.key}  asl ${kb(buffer.length)} -> ` +
          uploaded.map((variant) => `${variant.name}:${kb(variant.bytes)}`).join(" ")
      );
    } catch (error) {
      stats.failed += 1;
      stats.failures.push({ key: item.key, error: String(error?.message || error) });
      log(`[xato] ${item.key}: ${error?.message || error}`);
    }
  });

  if (fixCacheHeaders) {
    // Asl fayllarga uzoq muddatli kesh sarlavhasi: o'ziga o'zi nusxa (metadata almashtiriladi,
    // tarkib o'zgarmaydi). Qaytadan tashrif buyuruvchilar rasmni tarmoqdan qayta olmaydi.
    await runPool(originals, concurrency, async (item) => {
      try {
        const head = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: item.key }));
        if (head.CacheControl === CACHE_CONTROL) return;
        await s3.send(
          new CopyObjectCommand({
            Bucket: bucket,
            Key: item.key,
            CopySource: `${bucket}/${item.key}`,
            MetadataDirective: "REPLACE",
            ContentType: head.ContentType || "image/webp",
            CacheControl: CACHE_CONTROL
          })
        );
        stats.cacheHeadersFixed += 1;
      } catch (error) {
        stats.failures.push({ key: item.key, error: `cache-header: ${error?.message || error}` });
      }
    });
    log(`Kesh sarlavhasi qo'shildi: ${stats.cacheHeadersFixed} ta`);
  }

  return stats;
}

module.exports = { migrate };
