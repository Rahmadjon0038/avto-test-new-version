import { appendLanguageQuery, getBrowserLanguage, normalizeLanguageCode } from "@/lib/site-language";

export type CustomTestCard = {
  id: number;
  title: string;
  questionsCount?: number;
  questions?: Array<{
    id: string;
    text: string;
    image?: string;
    options: string[];
    correctIndex: number;
    explanation?: string;
  }>;
};

async function parseJson(res: Response) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as any)?.error || "So‘rov bajarilmadi");
  return data as any;
}

export async function fetchCustomTests(language?: string | null): Promise<CustomTestCard[]> {
  const lang = normalizeLanguageCode(language || getBrowserLanguage());
  const res = await fetch(appendLanguageQuery("/api/custom-tests", lang));
  const data = await parseJson(res);
  return Array.isArray(data.customTests) ? data.customTests : [];
}

export async function fetchCustomTestById(testId: string, language?: string | null): Promise<CustomTestCard | null> {
  const lang = normalizeLanguageCode(language || getBrowserLanguage());
  const res = await fetch(appendLanguageQuery(`/api/custom-tests/${encodeURIComponent(testId)}`, lang));
  if (res.status === 404) return null;
  const data = await parseJson(res);
  return data?.customTest || null;
}
