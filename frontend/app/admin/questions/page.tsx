"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, BookOpen, RefreshCw, Search, X } from "lucide-react";
import { useInfiniteQuery } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { useRouter } from "next/navigation";
import { useAuth } from "@/app/auth-provider";
import { jsonOrError } from "@/lib/api-authed";

type AdminQuestion = {
  id: string;
  kind: string;
  sourceId: string;
  sourceTitle: string;
  questionIndex: number;
  text: string;
  image: string;
  audio?: string;
  options: string[];
  correctIndex: number;
  correctAnswer: string;
  explanation: string;
  hasImage: boolean;
};

type AnswersPage = {
  questions: AdminQuestion[];
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
};

function questionLabel(number: number) {
  return `Savol ${String(number).padStart(2, "0")}`;
}

function resolveQuestionImage(image?: string) {
  const value = String(image || "").trim();
  if (!value) return "";
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

function resolveSourceHref(question: AdminQuestion) {
  if (question.kind === "topic" && question.sourceId) {
    return `/admin/topics/${encodeURIComponent(question.sourceId)}`;
  }
  return "/admin/topics";
}

export default function AdminQuestionsPage() {
  const { authFetch } = useAuth();
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const pageSize = 36;

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(search.trim());
    }, 300);

    return () => window.clearTimeout(timer);
  }, [search]);

  const questionsQuery = useInfiniteQuery({
    queryKey: ["admin-questions", debouncedSearch],
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams({
        offset: String(pageParam || 0),
        limit: String(pageSize),
        q: debouncedSearch
      });
      const res = await authFetch(`/api/answers?${params.toString()}`);
      const data = await jsonOrError(res);
      return {
        questions: Array.isArray(data.questions) ? (data.questions as AdminQuestion[]) : [],
        total: Number(data.total || 0),
        offset: Number(data.offset || 0),
        limit: Number(data.limit || pageSize),
        hasMore: Boolean(data.hasMore)
      } as AnswersPage;
    },
    getNextPageParam: (lastPage) => (lastPage.hasMore ? lastPage.offset + lastPage.limit : undefined)
  });

  useEffect(() => {
    if (questionsQuery.error) toast.error((questionsQuery.error as any)?.message || "Xatolik");
  }, [questionsQuery.error]);

  const questions = useMemo(() => (questionsQuery.data?.pages || []).flatMap((page) => page.questions), [questionsQuery.data]);
  const total = questionsQuery.data?.pages?.[0]?.total ?? questions.length;
  const isLoadingInitial = questionsQuery.isLoading || (questionsQuery.isFetching && !questionsQuery.data);

  return (
    <section className="adminSectionPage">
      <div className="adminSectionHeader">
        <button className="btn btn-ghost" type="button" onClick={() => router.push("/admin")}>
          <ArrowLeft className="lucide" aria-hidden="true" /> Orqaga
        </button>
        <button className="btn btn-ghost" type="button" onClick={() => questionsQuery.refetch()} disabled={questionsQuery.isFetching}>
          <RefreshCw className="lucide" aria-hidden="true" /> Yangilash
        </button>
      </div>

      <div className="answersHero card">
        <div className="answersHeroLeft">
          <div className="answersHeroIcon">
            <BookOpen className="lucide" aria-hidden="true" />
          </div>
          <div>
            <div className="answersTitle">Savollar nomi</div>
            <div className="muted">Barcha mavzulardagi savollar bitta ro‘yxatda. Search orqali tez topasiz.</div>
          </div>
        </div>
        <div className="answersHeroMeta">
          <span className="badge">{total} ta savol</span>
          <span className="badge">{questions.length} yuklandi</span>
          <span className="badge">{questionsQuery.hasNextPage ? "Davom etadi" : "Hammasi ko‘rildi"}</span>
        </div>
      </div>

      <div className="card answersSearch">
        <div className="adminPanelCardHead">
          <div className="adminPanelCardTitle">
            <Search className="lucide" aria-hidden="true" /> Search
          </div>
          <div className="adminPanelCardDesc">Savol matni, mavzu nomi, javob yoki izoh bo‘yicha qidirish mumkin.</div>
        </div>

        <div className="adminSearchWrap answersSearchWrap">
          <Search className="lucide adminSearchIcon" aria-hidden="true" />
          <input
            className="input adminSearchInput answersSearchInput"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Savol nomi yoki mavzu nomini yozing"
          />
          {search ? (
            <button className="adminSearchClear" type="button" onClick={() => setSearch("")} aria-label="Tozalash">
              <X className="lucide" aria-hidden="true" />
            </button>
          ) : null}
        </div>
      </div>

      {isLoadingInitial ? (
        <div className="card adminEmpty">
          <div className="adminEmptyTitle">Yuklanmoqda...</div>
          <div className="adminEmptyText">Savollar ro‘yxati tayyorlanmoqda.</div>
        </div>
      ) : questions.length ? (
        <>
          <div className="answersQuestionGrid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))" }}>
            {questions.map((question) => {
              const sourceHref = resolveSourceHref(question);
              const correctOption = Array.isArray(question.options) ? question.options[question.correctIndex] || question.correctAnswer : question.correctAnswer;

              return (
                <article key={question.id} className="card answersQuestionCard">
                  <div className="answersQuestionCardHead">
                    <div className="answersQuestionCardMeta">
                      <span className="badge">{questionLabel(Number(question.questionIndex || 0))}</span>
                      <span className="badge">{question.sourceTitle || "Mavzu"}</span>
                    </div>
                    <Link href={sourceHref} className="btn btn-ghost btn-sm">
                      Mavzuga o‘tish
                    </Link>
                  </div>

                  <div className="answersQuestionTextBig">{question.text || "Savol matni yo‘q"}</div>

                  {resolveQuestionImage(question.image) ? (
                    <div className="answersQuestionImageWrap">
                      <img
                        className="answersQuestionImage"
                        src={resolveQuestionImage(question.image)}
                        alt={question.text || "Savol rasmi"}
                        loading="lazy"
                      />
                    </div>
                  ) : null}

                  {Array.isArray(question.options) && question.options.length ? (
                    <div className="answersOptions">
                      {question.options.map((option, optionIndex) => (
                        <div
                          key={`${question.id}-${optionIndex}`}
                          className={`option ${optionIndex === question.correctIndex ? "correct" : ""}`}
                        >
                          <span className="optionKey">{String.fromCharCode(65 + optionIndex)}</span>
                          <span className="optionText">{option || "Bo‘sh variant"}</span>
                        </div>
                      ))}
                    </div>
                  ) : null}

                  <div className="answersAnswer">
                    <span className="badge badge-success">To‘g‘ri javob</span>
                    <strong>{correctOption || "Noma’lum"}</strong>
                  </div>

                  {question.explanation ? <div className="answersExplanation">{question.explanation}</div> : null}
                </article>
              );
            })}
          </div>

          <div className="adminSectionHeader">
            <div className="adminSectionSub">{questions.length} / {total} ta savol ko‘rsatildi</div>
            {questionsQuery.hasNextPage ? (
              <button className="btn btn-ghost" type="button" onClick={() => questionsQuery.fetchNextPage()} disabled={questionsQuery.isFetchingNextPage}>
                <RefreshCw className="lucide" aria-hidden="true" /> Ko‘proq yuklash
              </button>
            ) : null}
          </div>
        </>
      ) : (
        <section className="adminEmpty card">
          <div className="adminEmptyTitle">Savol topilmadi</div>
          <div className="adminEmptyText">Search natijasida mos savol chiqmayapti.</div>
        </section>
      )}
    </section>
  );
}
