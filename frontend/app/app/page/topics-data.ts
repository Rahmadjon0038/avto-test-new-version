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

export async function fetchTopics(): Promise<TopicCard[]> {
  const res = await fetch("/api/topics");
  const data = await parseJson(res);
  return Array.isArray(data.topics) ? data.topics : [];
}

export async function fetchTopicById(topicId: string): Promise<TopicCard | null> {
  const res = await fetch(`/api/topics/${encodeURIComponent(topicId)}`);
  if (res.status === 404) return null;
  const data = await parseJson(res);
  return data?.topic || null;
}
