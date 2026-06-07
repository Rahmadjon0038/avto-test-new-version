"use client";

import { useEffect } from "react";
import { Check, LayoutGrid } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { useAuth } from "@/app/auth-provider";
import { jsonOrError } from "@/lib/api-authed";
import type { TopicCard } from "../topics-data";

export default function TopicsPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const { authFetch, authReady } = useAuth();
  const topicsQuery = useQuery({
    queryKey: ["topics"],
    queryFn: async () => {
      const res = await authFetch("/api/topics");
      const data = await jsonOrError(res);
      return Array.isArray(data.topics) ? (data.topics as TopicCard[]) : [];
    },
    enabled: authReady
  });

  useEffect(() => {
    if (topicsQuery.error) {
      toast.error((topicsQuery.error as any)?.message || "Xatolik");
    }
  }, [topicsQuery.error]);

  const toggleCompleteMutation = useMutation({
    mutationFn: async ({ topicId, completed }: { topicId: number; completed: boolean }) => {
      const res = await authFetch(`/api/topic-progress/${encodeURIComponent(String(topicId))}/complete`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ completed })
      });
      return jsonOrError(res);
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["topics"] });
    },
    onError: (error: any) => toast.error(error?.message || "Xatolik")
  });

  return (
    <section className="view">
      <div className="topicsHero card">
        <div className="topicsHeroIcon">
          <LayoutGrid className="lucide" aria-hidden="true" />
        </div>
        <div>
          <div className="topicsTitle">Mavzularni tanlang</div>
          <div className="topicsSub">Kartaga bosganda shu mavzuning alohida sahifasi ochiladi.</div>
        </div>
      </div>

      {topicsQuery.isLoading ? <div className="muted">Mavzular yuklanmoqda...</div> : null}

      <div className="topicsGrid">
        {(topicsQuery.data || []).map((topic, index) => (
          <article
            key={topic.id}
            className={`topicCard ${topic.completed ? "isCompleted" : ""}`}
            role="button"
            tabIndex={0}
            onClick={() => router.push(`/app/page/topics/${topic.id}`)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") router.push(`/app/page/topics/${topic.id}`);
            }}
          >
            <button
              className={`topicCheck ${topic.completed ? "active" : ""}`}
              type="button"
              aria-label={topic.completed ? "Tugallangan deb belgilangan" : "Tugallangan deb belgilash"}
              aria-pressed={Boolean(topic.completed)}
              onClick={(event) => {
                event.stopPropagation();
                toggleCompleteMutation.mutate({ topicId: topic.id, completed: !topic.completed });
              }}
              disabled={toggleCompleteMutation.isPending}
            >
              <Check className="lucide" aria-hidden="true" />
            </button>
            <span className="topicIndex" aria-hidden="true">
              {String(index + 1).padStart(2, "0")}
            </span>
            <div className="topicName">{topic.title}</div>
          </article>
        ))}
      </div>
    </section>
  );
}
