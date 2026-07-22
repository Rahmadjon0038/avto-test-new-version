import { cookies } from "next/headers";
import { DEFAULT_LANGUAGE, LANGUAGE_COOKIE, normalizeLanguageCode, type LanguageCode } from "./site-language";

export async function getServerLanguage(): Promise<LanguageCode> {
  const cookieStore = await cookies();
  const value = cookieStore.get(LANGUAGE_COOKIE)?.value || cookieStore.get("lang")?.value || "";
  return normalizeLanguageCode(value, DEFAULT_LANGUAGE);
}
