export const siteName = "Topshirdi";
export const siteDescription =
  "Topshirdi — avto test, avto imtihon va avtomobil biletlari platformasi. Haydovchilikka tayyorlanish uchun mavzuli testlar, biletlar, xatolarni ko‘rish, imtihon rejimi va video darslar bir joyda.";
export const siteKeywords = [
  "topshirdi",
  "Topshirdi",
  "topshirdi.uz",
  "topshirdi avto test",
  "topshirdi avto imtihon",
  "avto test",
  "avto imtihon",
  "avto testlar",
  "avtomobil",
  "avtomobil test",
  "avtomobil imtihon",
  "avtomobil testlari",
  "avtomobil haydash",
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
  "uzbek driving test"
];

export function getSiteUrl() {
  const rawUrl =
    process.env.NODE_ENV === "development"
      ? process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"
      : process.env.NEXT_PUBLIC_SITE_URL || process.env.BASE_URL || "https://topshirdi.uz";

  try {
    return new URL(rawUrl);
  } catch {
    return new URL(process.env.NODE_ENV === "development" ? "http://localhost:3000" : "https://topshirdi.uz");
  }
}
