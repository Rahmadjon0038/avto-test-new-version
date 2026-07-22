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

export async function fetchCustomTests(): Promise<CustomTestCard[]> {
  const res = await fetch(appendLanguageQuery("/api/custom-tests", getBrowserLanguage()));
  const data = await parseJson(res);
  return Array.isArray(data.customTests) ? data.customTests : [];
}

export async function fetchCustomTestById(testId: string): Promise<CustomTestCard | null> {
  const res = await fetch(appendLanguageQuery(`/api/custom-tests/${encodeURIComponent(testId)}`, getBrowserLanguage()));
  if (res.status === 404) return null;
  const data = await parseJson(res);
  return data?.customTest || null;
}
import { appendLanguageQuery, getBrowserLanguage } from "@/lib/site-language";
