import { appendLanguageQuery, getBrowserLanguage, normalizeLanguageCode } from "@/lib/site-language";

export type TopicCard = {
  id: number;
  title: string;
  completed?: boolean;
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

export async function fetchTopics(language?: string | null): Promise<TopicCard[]> {
  const lang = normalizeLanguageCode(language || getBrowserLanguage());
  const res = await fetch(appendLanguageQuery("/api/topics", lang));
  const data = await parseJson(res);
  return Array.isArray(data.topics) ? data.topics : [];
}

export async function fetchTopicById(topicId: string, language?: string | null): Promise<TopicCard | null> {
  const lang = normalizeLanguageCode(language || getBrowserLanguage());
  const res = await fetch(appendLanguageQuery(`/api/topics/${encodeURIComponent(topicId)}`, lang));
  if (res.status === 404) return null;
  const data = await parseJson(res);
  return data?.topic || null;
}
