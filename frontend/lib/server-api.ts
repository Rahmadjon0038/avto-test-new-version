export function getBackendUrl() {
  return (
    process.env.BACKEND_URL ||
    process.env.NEXT_PUBLIC_BACKEND_URL ||
    "https://api.topshirdi.uz"
  );
}

export type PublicQuestion = {
  id: string;
  text: string;
  image?: string;
  audio?: string;
  options: string[];
  correctIndex: number;
  explanation?: string;
};

export type PublicTicket = { id: string; title: string; questions: Array<PublicQuestion | null> };
export type PublicTopic = { id: number; slug: string; title: string; questions: PublicQuestion[] };
export type PublicTicketSummary = { id: string; title: string; free: boolean; questionCount: number };
export type PublicTopicSummary = { id: number; slug: string; title: string; free: boolean; questionCount: number };

async function getJson(path: string): Promise<{ ok: boolean; status: number; data: any }> {
  try {
    const res = await fetch(`${getBackendUrl()}${path}`, { next: { revalidate: 300 } });
    const data = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: null };
  }
}

export async function fetchPublicTickets(): Promise<PublicTicketSummary[]> {
  const r = await getJson("/api/public/tickets");
  return r.ok && Array.isArray(r.data?.tickets) ? r.data.tickets : [];
}

export async function fetchPublicTicket(id: string): Promise<{ ticket: PublicTicket | null; status: number }> {
  const r = await getJson(`/api/public/tickets/${encodeURIComponent(id)}`);
  return { ticket: r.ok ? (r.data?.ticket ?? null) : null, status: r.status };
}

export async function fetchPublicTopics(): Promise<PublicTopicSummary[]> {
  const r = await getJson("/api/public/topics");
  return r.ok && Array.isArray(r.data?.topics) ? r.data.topics : [];
}

export async function fetchPublicTopic(id: string): Promise<{ topic: PublicTopic | null; status: number }> {
  const r = await getJson(`/api/public/topics/${encodeURIComponent(id)}`);
  return { topic: r.ok ? (r.data?.topic ?? null) : null, status: r.status };
}

export function resolveQuestionImage(image?: string) {
  const value = String(image || "").trim();
  if (!value) return "/default.png";
  if (value.startsWith("/")) return value;
  if (/^https?:\/\//i.test(value)) {
    try {
      const parsed = new URL(value);
      if (parsed.hostname.endsWith("r2.dev") || parsed.hostname.endsWith("r2.cloudflarestorage.com")) {
        return value;
      }
    } catch {
      // fall through to proxy
    }
    return `/api/image?u=${encodeURIComponent(value)}`;
  }
  return value;
}
