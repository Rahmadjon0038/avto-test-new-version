"use client";

import { useEffect, useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const QUERY_SYNC_CHANNEL = "topshirdi-react-query-sync";

type QuerySyncMessage =
  | {
      type: "invalidate";
      queryKey: unknown[];
      exact?: boolean;
    }
  | {
      type: "remove";
      queryKey: unknown[];
      exact?: boolean;
    };

export function broadcastQuerySync(message: QuerySyncMessage) {
  const win: any = globalThis;

  if (!win) return;

  if ("BroadcastChannel" in win) {
    const channel = new BroadcastChannel(QUERY_SYNC_CHANNEL);
    channel.postMessage(message);
    channel.close();
    return;
  }

  try {
    const payload = JSON.stringify({ ...message, ts: Date.now() });
    const storage = globalThis.localStorage as Storage | undefined;
    if (!storage) return;
    storage.setItem(QUERY_SYNC_CHANNEL, payload);
    storage.removeItem(QUERY_SYNC_CHANNEL);
  } catch {
    // Best effort only.
  }
}

export default function QueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60 * 1000,
            gcTime: 10 * 60 * 1000,
            retry: 1,
            refetchOnWindowFocus: false,
            refetchOnMount: false,
            refetchOnReconnect: false
          }
        }
      })
  );

  useEffect(() => {
    const win: any = globalThis;

    const applyMessage = (message: QuerySyncMessage | null) => {
      if (!message || !Array.isArray(message.queryKey) || !message.queryKey.length) return;
      if (message.type === "remove") {
        client.removeQueries({ queryKey: message.queryKey, exact: Boolean(message.exact) });
        return;
      }
      client.invalidateQueries({ queryKey: message.queryKey, exact: Boolean(message.exact) });
    };

    const onStorage = (event: StorageEvent) => {
      if (event.key !== QUERY_SYNC_CHANNEL || !event.newValue) return;
      try {
        const message = JSON.parse(event.newValue) as QuerySyncMessage;
        applyMessage(message);
      } catch {
        // Ignore malformed payloads.
      }
    };

    const onBroadcast = (event: MessageEvent<QuerySyncMessage>) => {
      applyMessage(event.data);
    };

    if ("BroadcastChannel" in win) {
      const channel = new BroadcastChannel(QUERY_SYNC_CHANNEL);
      channel.addEventListener("message", onBroadcast);
      win.addEventListener("storage", onStorage);
      return () => {
        channel.removeEventListener("message", onBroadcast);
        channel.close();
        win.removeEventListener("storage", onStorage);
      };
    }

    win.addEventListener("storage", onStorage);
    return () => win.removeEventListener("storage", onStorage);
  }, [client]);

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
