import { openDB, type IDBPDatabase } from "idb";

// Local-first question cache: topics/tickets/customTests (each holding its own `questions` array)
// plus a small `meta` store for the sync cursor. `mistakes` is the one user-specific store here —
// it's namespaced per user id (see setMistakesForUser) and cleared on logout, unlike the shared
// question content which stays regardless of who's logged in.
const DB_NAME = "topshirdi-content";
const DB_VERSION = 2;

export type CachedQuestion = {
  id: string;
  text: string;
  image?: string;
  audio?: string;
  options: string[];
  correctIndex: number;
  explanation?: string;
  [key: string]: unknown;
};

export type CachedTopic = {
  id: number;
  slug: string;
  title: string;
  titleI18n?: Record<string, string>;
  questions: CachedQuestion[];
  adminMarked?: boolean;
  updated_at?: string;
};

export type CachedTicket = {
  id: string;
  title: string;
  titleI18n?: Record<string, string>;
  status?: string;
  ticketNumber?: number;
  questions: Array<CachedQuestion | null>;
  created_at?: string;
  updated_at?: string;
};

export type CachedCustomTest = {
  id: number;
  title: string;
  questions: CachedQuestion[];
  questionsCount?: number;
  updated_at?: string;
};

export type CachedMistake = {
  id: string;
  kind: string;
  sourceId: string;
  sourceTitle: string;
  questionIndex: number;
  text: string;
  image?: string;
  audio?: string;
  options: string[];
  correctIndex: number;
  correctAnswer: string;
  explanation: string;
  hasImage: boolean;
  wrongAnswer: number | null;
  [key: string]: unknown;
};

type MetaRow = { key: string; value: unknown };

function isIndexedDbAvailable(): boolean {
  return typeof indexedDB !== "undefined";
}

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDb(): Promise<IDBPDatabase> | null {
  if (!isIndexedDbAvailable()) return null;
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains("topics")) db.createObjectStore("topics", { keyPath: "id" });
        if (!db.objectStoreNames.contains("tickets")) db.createObjectStore("tickets", { keyPath: "id" });
        if (!db.objectStoreNames.contains("customTests")) db.createObjectStore("customTests", { keyPath: "id" });
        if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta", { keyPath: "key" });
        if (!db.objectStoreNames.contains("mistakes")) db.createObjectStore("mistakes", { keyPath: "id" });
      }
    }).catch(() => null as unknown as IDBPDatabase);
  }
  return dbPromise;
}

async function safeDb(): Promise<IDBPDatabase | null> {
  const promise = getDb();
  if (!promise) return null;
  try {
    const db = await promise;
    return db || null;
  } catch {
    return null;
  }
}

export async function getCachedTopic(topicId: string | number): Promise<CachedTopic | null> {
  const db = await safeDb();
  if (!db) return null;
  try {
    return (await db.get("topics", Number(topicId))) || null;
  } catch {
    return null;
  }
}

export async function getCachedTicket(ticketId: string | number): Promise<CachedTicket | null> {
  const db = await safeDb();
  if (!db) return null;
  try {
    return (await db.get("tickets", String(ticketId))) || null;
  } catch {
    return null;
  }
}

export async function getCachedCustomTest(testId: string | number): Promise<CachedCustomTest | null> {
  const db = await safeDb();
  if (!db) return null;
  try {
    return (await db.get("customTests", Number(testId))) || null;
  } catch {
    return null;
  }
}

export async function getAllCachedTopics(): Promise<CachedTopic[]> {
  const db = await safeDb();
  if (!db) return [];
  try {
    return (await db.getAll("topics")) || [];
  } catch {
    return [];
  }
}

export async function getAllCachedTickets(): Promise<CachedTicket[]> {
  const db = await safeDb();
  if (!db) return [];
  try {
    return (await db.getAll("tickets")) || [];
  } catch {
    return [];
  }
}

export async function getMeta<T = unknown>(key: string): Promise<T | null> {
  const db = await safeDb();
  if (!db) return null;
  try {
    const row = (await db.get("meta", key)) as MetaRow | undefined;
    return (row?.value as T) ?? null;
  } catch {
    return null;
  }
}

// Applies one sync cycle atomically: all store writes happen inside a single transaction per
// store type, and `meta` (which holds the cursor the caller advances to) is only written last,
// after the content writes are queued in the same tick — if any write throws, the whole
// transaction aborts and nothing (including the cursor) is committed.
export async function applyContentSyncResult(input: {
  topics?: { updated: CachedTopic[]; deletedIds: Array<string | number> };
  tickets?: { updated: CachedTicket[]; deletedIds: Array<string | number> };
  customTests?: { updated: CachedCustomTest[]; deletedIds: Array<string | number> };
  meta: Record<string, unknown>;
}): Promise<boolean> {
  const db = await safeDb();
  if (!db) return false;
  try {
    const storeNames: Array<"topics" | "tickets" | "customTests" | "meta"> = ["meta"];
    if (input.topics) storeNames.push("topics");
    if (input.tickets) storeNames.push("tickets");
    if (input.customTests) storeNames.push("customTests");

    const tx = db.transaction(storeNames, "readwrite");

    if (input.topics) {
      const store = tx.objectStore("topics");
      for (const topic of input.topics.updated) await store.put(topic);
      for (const id of input.topics.deletedIds) await store.delete(Number(id));
    }
    if (input.tickets) {
      const store = tx.objectStore("tickets");
      for (const ticket of input.tickets.updated) await store.put(ticket);
      for (const id of input.tickets.deletedIds) await store.delete(String(id));
    }
    if (input.customTests) {
      const store = tx.objectStore("customTests");
      for (const test of input.customTests.updated) await store.put(test);
      for (const id of input.customTests.deletedIds) await store.delete(Number(id));
    }

    const metaStore = tx.objectStore("meta");
    for (const [key, value] of Object.entries(input.meta)) {
      await metaStore.put({ key, value });
    }

    await tx.done;
    return true;
  } catch {
    return false;
  }
}

export async function putCachedTopic(topic: CachedTopic): Promise<void> {
  const db = await safeDb();
  if (!db) return;
  try {
    await db.put("topics", topic);
  } catch {
    // best effort only
  }
}

export async function putCachedTicket(ticket: CachedTicket): Promise<void> {
  const db = await safeDb();
  if (!db) return;
  try {
    await db.put("tickets", ticket);
  } catch {
    // best effort only
  }
}

export async function putCachedCustomTest(test: CachedCustomTest): Promise<void> {
  const db = await safeDb();
  if (!db) return;
  try {
    await db.put("customTests", test);
  } catch {
    // best effort only
  }
}

async function setMeta(key: string, value: unknown): Promise<void> {
  const db = await safeDb();
  if (!db) return;
  try {
    await db.put("meta", { key, value });
  } catch {
    // best effort only
  }
}

// Mistakes are per-user progress data, not shared content — kept in their own store and wiped
// whenever the logged-in account changes (including on logout), unlike topics/tickets/customTests.
export async function getCachedMistakes(userId: string): Promise<CachedMistake[]> {
  const db = await safeDb();
  if (!db) return [];
  try {
    const owner = await getMeta<string>("mistakesUserId");
    if (owner !== String(userId)) return [];
    return (await db.getAll("mistakes")) || [];
  } catch {
    return [];
  }
}

export async function setMistakesForUser(userId: string, mistakes: CachedMistake[]): Promise<void> {
  const db = await safeDb();
  if (!db) return;
  try {
    const owner = await getMeta<string>("mistakesUserId");
    const tx = db.transaction(["mistakes", "meta"], "readwrite");
    const store = tx.objectStore("mistakes");
    if (owner !== String(userId)) await store.clear();
    for (const mistake of mistakes) await store.put(mistake);
    await tx.objectStore("meta").put({ key: "mistakesUserId", value: String(userId) });
    await tx.done;
  } catch {
    // best effort only
  }
}

export async function removeCachedMistake(id: string): Promise<void> {
  const db = await safeDb();
  if (!db) return;
  try {
    await db.delete("mistakes", id);
  } catch {
    // best effort only
  }
}

export async function clearUserScopedCaches(): Promise<void> {
  const db = await safeDb();
  if (!db) return;
  try {
    const tx = db.transaction(["mistakes", "meta"], "readwrite");
    await tx.objectStore("mistakes").clear();
    await tx.objectStore("meta").delete("mistakesUserId");
    await tx.objectStore("meta").delete("examSnapshotUserId");
    await tx.objectStore("meta").delete("examSnapshot");
    await tx.done;
  } catch {
    // best effort only
  }
}

export async function getCachedExamSnapshot(userId: string): Promise<unknown | null> {
  const owner = await getMeta<string>("examSnapshotUserId");
  if (owner !== String(userId)) return null;
  return getMeta("examSnapshot");
}

export async function putCachedExamSnapshot(userId: string, snapshot: unknown): Promise<void> {
  await setMeta("examSnapshotUserId", String(userId));
  await setMeta("examSnapshot", snapshot);
}
