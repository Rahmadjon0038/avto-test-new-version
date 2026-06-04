export type CustomTestCard = {
  id: number;
  title: string;
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
  if (!res.ok) throw new Error((data as any)?.error || "Request failed");
  return data as any;
}

export async function fetchCustomTests(): Promise<CustomTestCard[]> {
  const res = await fetch("/api/custom-tests");
  const data = await parseJson(res);
  return Array.isArray(data.customTests) ? data.customTests : [];
}

export async function fetchCustomTestById(testId: string): Promise<CustomTestCard | null> {
  const res = await fetch(`/api/custom-tests/${encodeURIComponent(testId)}`);
  if (res.status === 404) return null;
  const data = await parseJson(res);
  return data?.customTest || null;
}
