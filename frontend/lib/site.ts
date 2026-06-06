export const siteName = "Road Test";
export const siteDescription =
  "Road Test — haydovchilikka tayyorlanish uchun avto test, road test, avto imtihon, biletlar, xatolarni ko‘rish, imtihon rejimi va video darslar platformasi.";
export const siteKeywords = [
  "avto test",
  "road test",
  "roadt test",
  "avto imtihon",
  "avto testlar",
  "haydovchilikka tayyorlanish",
  "haydovchilik testlari",
  "biletlar bo‘yicha test",
  "yo'l harakati qoidalari",
  "PDD test",
  "yo'l harakati qoidalari test",
  "bilet testlari",
  "imtihon rejimi",
  "video darslar",
  "mavzuli testlar",
  "driving test",
  "uzbek avto test",
  "uzbek driving test",
  "road test uzbek"
];

export function getSiteUrl() {
  const rawUrl =
    process.env.NODE_ENV === "development"
      ? process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"
      : process.env.NEXT_PUBLIC_SITE_URL || process.env.BASE_URL || "http://localhost:3000";

  try {
    return new URL(rawUrl);
  } catch {
    return new URL("http://localhost:3000");
  }
}
