"use client";

import { useEffect } from "react";
import { ArrowLeft, Check, LayoutGrid } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { useAuth } from "@/app/auth-provider";
import { useSiteLanguage } from "@/app/site-language-provider";
import { jsonOrError } from "@/lib/api-authed";
import { readPersisted, writePersisted } from "@/lib/persisted-cache";
import type { TopicCard } from "../topics-data";

export default function TopicsPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const { authFetch, authReady, user } = useAuth();
  const { t, language } = useSiteLanguage();
  // Ro'yxat uchun faqat id, nom va "tugallangan" belgisi kerak (lite=1): har bir mavzuning
  // javoblar xaritasi yuklanmaydi. Oxirgi ro'yxat localStorage'dan darhol chiqadi, orqada ETag
  // bilan tekshiriladi (o'zgarmagan bo'lsa javob bo'sh — 304).
  // Kesh foydalanuvchi bo'yicha ajratiladi: boshqa akkauntning belgilari placeholder sifatida
  // ham ko'rinmasligi uchun user id ma'lum bo'lmaguncha kesh o'qilmaydi ham, yozilmaydi ham.
  const userId = user?.id ? String(user.id) : null;
  const cacheKey = `topics-lite:${userId}:${language}`;
  const topicsQueryKey = ["topics", language];
  const topicsQuery = useQuery({
    queryKey: topicsQueryKey,
    queryFn: async () => {
      const res = await authFetch("/api/topics?lite=1", { cache: "no-cache" });
      const data = await jsonOrError(res);
      const topics = Array.isArray(data.topics) ? (data.topics as TopicCard[]) : [];
      if (userId) writePersisted(cacheKey, topics);
      return topics;
    },
    placeholderData: () => (userId ? readPersisted<TopicCard[]>(cacheKey) : undefined),
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
    // Optimistik yangilash: belgi darhol o'zgaradi, xato bo'lsa avvalgi holatga qaytadi.
    onMutate: async ({ topicId, completed }) => {
      await qc.cancelQueries({ queryKey: topicsQueryKey });
      const previous = qc.getQueryData<TopicCard[]>(topicsQueryKey);
      qc.setQueryData<TopicCard[]>(topicsQueryKey, (current) =>
        current?.map((topic) => (topic.id === topicId ? { ...topic, completed } : topic))
      );
      return { previous };
    },
    onError: (error: any, _variables, context) => {
      if (context?.previous) qc.setQueryData(topicsQueryKey, context.previous);
      toast.error(error?.message || "Xatolik");
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["topics"] })
  });

  return (
    <section className="view">
      <div style={{ marginBottom: 12 }}>
        <button className="btn btn-ghost btn-sm" type="button" onClick={() => router.push("/app")}>
          <ArrowLeft className="lucide" aria-hidden="true" /> {t("common.back")}
        </button>
      </div>

      <div className="topicsHero card">
        <div className="topicsHeroIcon">
          <LayoutGrid className="lucide" aria-hidden="true" />
        </div>
        <div>
          <div className="topicsTitle">{t("topics.title")}</div>
          <div className="topicsSub">{t("topics.subtitle")}</div>
        </div>
      </div>

      <div className="topicsGrid" aria-busy={topicsQuery.isLoading}>
        {topicsQuery.isLoading
          ? Array.from({ length: 12 }, (_, index) => (
              <div key={index} className="topicCard topicCardCentered ticketCardSkeleton" aria-hidden="true" />
            ))
          : null}
        {(topicsQuery.data || []).map((topic, index) => (
          <article
            key={topic.id}
            className={`topicCard topicCardCentered ${topic.completed ? "isCompleted" : ""}`}
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
            <div className="topicNameRow">
              <div className="topicName">{topic.title}</div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
