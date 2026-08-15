"use client";

import { broadcastQuerySync } from "@/app/query-provider";
import { applyContentSyncResult, getMeta, type CachedCustomTest, type CachedTicket, type CachedTopic } from "./content-db";

const LOCAL_VERSION_KEY = "localVersion";
const LAST_SYNC_KEY = "lastSync";

type SyncResponse = {
  version: number;
  upToDate?: boolean;
  syncedAt: string;
  topics?: { updated: CachedTopic[]; deletedIds: Array<string | number> };
  tickets?: { updated: CachedTicket[]; deletedIds: Array<string | number> };
  customTests?: { updated: CachedCustomTest[]; deletedIds: Array<string | number> };
};

export type AuthFetch = (path: string, init?: RequestInit) => Promise<Response>;
export type SyncResult = { changed: boolean; version: number };

function devLog(...args: unknown[]) {
  if (process.env.NODE_ENV !== "production") {
    // eslint-disable-next-line no-console
    console.log("[ContentSync]", ...args);
  }
}

// Single-flight guard: if several test pages mount around the same time and all call
// ensureSynced(), only one actual network round trip + IndexedDB write happens.
let syncPromise: Promise<SyncResult> | null = null;

export function ensureSynced(authFetch: AuthFetch): Promise<SyncResult> {
  if (syncPromise) return syncPromise;
  syncPromise = runSync(authFetch).finally(() => {
    syncPromise = null;
  });
  return syncPromise;
}

async function runSync(authFetch: AuthFetch): Promise<SyncResult> {
  const localVersion = Number((await getMeta<number>(LOCAL_VERSION_KEY)) || 0);
  const lastSync = (await getMeta<string>(LAST_SYNC_KEY)) || "";
  devLog("Local version:", localVersion);

  try {
    const params = new URLSearchParams();
    params.set("version", String(localVersion));
    if (lastSync) params.set("updatedAfter", lastSync);
    const res = await authFetch(`/api/content/sync?${params.toString()}`);
    if (!res.ok) {
      devLog("Sync request failed with status", res.status);
      return { changed: false, version: localVersion };
    }
    const data: SyncResponse = await res.json();
    devLog("Server version:", data.version);

    if (data.upToDate) {
      devLog("Already up to date, nothing to fetch");
      return { changed: false, version: data.version };
    }

    const updatedCount =
      (data.topics?.updated.length || 0) + (data.tickets?.updated.length || 0) + (data.customTests?.updated.length || 0);
    const deletedCount =
      (data.topics?.deletedIds.length || 0) +
      (data.tickets?.deletedIds.length || 0) +
      (data.customTests?.deletedIds.length || 0);
    devLog(`${updatedCount} item(s) updated`);
    devLog(`${deletedCount} item(s) deleted`);

    const applied = await applyContentSyncResult({
      topics: data.topics,
      tickets: data.tickets,
      customTests: data.customTests,
      meta: { [LOCAL_VERSION_KEY]: data.version, [LAST_SYNC_KEY]: data.syncedAt }
    });

    if (!applied) {
      // IndexedDB unavailable or the write failed partway — keep the previous good local
      // dataset and cursor untouched so the next sync retries from the same point.
      devLog("Could not persist locally; local version left unchanged");
      return { changed: false, version: localVersion };
    }

    devLog("Sync completed");

    for (const topic of data.topics?.updated || []) {
      broadcastQuerySync({ type: "invalidate", queryKey: ["topic", String(topic.id)] });
    }
    for (const ticket of data.tickets?.updated || []) {
      broadcastQuerySync({ type: "invalidate", queryKey: ["ticket", String(ticket.id)] });
    }
    for (const test of data.customTests?.updated || []) {
      broadcastQuerySync({ type: "invalidate", queryKey: ["custom-test", String(test.id)] });
    }

    return { changed: updatedCount > 0 || deletedCount > 0, version: data.version };
  } catch (error) {
    devLog("Sync error", error);
    return { changed: false, version: localVersion };
  }
}
