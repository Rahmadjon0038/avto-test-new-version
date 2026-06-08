"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, BookOpen, Filter, Image, ImageOff, Search } from "lucide-react";
import { useInfiniteQuery } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { useAuth } from "@/app/auth-provider";
import { jsonOrError } from "@/lib/api-authed";

type AnswerQuestion = {
  id: string;
  kind: "ticket" | "topic" | "custom";
  sourceId: string;
  sourceTitle: string;
  questionIndex: number;
  text: string;
  image: string;
  options: string[];
  correctIndex: number;
  correctAnswer: string;
  explanation: string;
  hasImage: boolean;
};

type AnswersPage = {
  questions: AnswerQuestion[];
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
};

type FilterKey = "all" | "with-image" | "without-image";

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

function resolveFilterLabel(filter: FilterKey) {
  if (filter === "with-image") return "Rasmli testlar";
  if (filter === "without-image") return "Rasmsiz testlar";
  return "Barchasi";
}

function questionKeyLabel(index: number) {
  return `Savol ${String(index + 1).padStart(2, "0")}`;
}

export default function AnswersPage() {
  const { authFetch } = useAuth();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterKey>("all");
  const pageSize = 40;

  const answersQuery = useInfiniteQuery({
    queryKey: ["answers", search, filter],
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams({
        offset: String(pageParam || 0),
        limit: String(pageSize),
        filter,
        q: search.trim()
      });
      const res = await authFetch(`/api/answers?${params.toString()}`);
      const data = await jsonOrError(res);
      return {
        questions: Array.isArray(data.questions) ? (data.questions as AnswerQuestion[]) : [],
        total: Number(data.total || 0),
        offset: Number(data.offset || 0),
        limit: Number(data.limit || pageSize),
        hasMore: Boolean(data.hasMore)
      } as AnswersPage;
    },
    getNextPageParam: (lastPage) => (lastPage.hasMore ? lastPage.offset + lastPage.limit : undefined)
  });

  useEffect(() => {
    if (answersQuery.error) toast.error((answersQuery.error as any)?.message || "Xatolik");
  }, [answersQuery.error]);

  const questions = useMemo(() => (answersQuery.data?.pages || []).flatMap((page) => page.questions), [answersQuery.data]);
  const total = answersQuery.data?.pages?.[0]?.total ?? questions.length;

  const counts = useMemo(
    () => ({
      all: total,
      loaded: questions.length
    }),
    [questions.length, total]
  );

  const isLoadingInitial = answersQuery.isLoading || (answersQuery.isFetching && !answersQuery.data);
  const isLoadingMore = answersQuery.isFetchingNextPage;

  return (
    <section className="view">
      <div className="sectionTopBar" style={{ marginBottom: 12 }}>
        <button className="btn btn-ghost btn-sm" type="button" onClick={() => window.history.back()}>
          <ArrowLeft className="lucide" aria-hidden="true" /> Orqaga
        </button>
      </div>

      <div className="answersHero card">
        <div className="answersHeroLeft">
          <div className="answersHeroIcon">
            <BookOpen className="lucide" aria-hidden="true" />
          </div>
          <div>
            <div className="answersTitle">Barcha testlar javoblari</div>
            <div className="muted">Tizimdagi barcha bo‘limlardagi savollar alohida kartalarda ko‘rsatiladi.</div>
          </div>
        </div>
        <div className="answersHeroMeta">
          <span className="badge">{counts.all} ta savol</span>
          <span className="badge">{counts.loaded} yuklandi</span>
          <span className="badge">{answersQuery.hasNextPage ? "Davom etadi" : "Hammasi"}</span>
        </div>
      </div>

      <div className="answersFilters">
        <button className={`answersFilter ${filter === "all" ? "active" : ""}`} type="button" onClick={() => setFilter("all")}>
          <Filter className="lucide" aria-hidden="true" />
          <span>{resolveFilterLabel("all")}</span>
        </button>
        <button className={`answersFilter ${filter === "with-image" ? "active" : ""}`} type="button" onClick={() => setFilter("with-image")}>
          <Image className="lucide" aria-hidden="true" />
          <span>{resolveFilterLabel("with-image")}</span>
        </button>
        <button className={`answersFilter ${filter === "without-image" ? "active" : ""}`} type="button" onClick={() => setFilter("without-image")}>
          <ImageOff className="lucide" aria-hidden="true" />
          <span>{resolveFilterLabel("without-image")}</span>
        </button>
      </div>

      <div className="answersSearch card">
        <div className="adminPanelCardHead">
          <div className="adminPanelCardTitle">
            <Search className="lucide" aria-hidden="true" /> Qidirish
          </div>
        </div>
        <div className="adminSearchWrap">
          <Search className="lucide adminSearchIcon" aria-hidden="true" />
          <input
            className="input adminSearchInput"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Savol matni, izoh yoki test nomi bo‘yicha qidiring"
          />
        </div>
      </div>

      {isLoadingInitial ? <div className="muted">Savollar yuklanmoqda...</div> : null}

      {!isLoadingInitial && questions.length === 0 ? (
        <section className="card answersEmpty">
          <div className="adminEmptyTitle">Hech narsa topilmadi</div>
          <div className="adminEmptyText">Tanlangan filtr bo‘yicha savol yo‘q.</div>
        </section>
      ) : null}

      <div className="answersQuestionGrid">
        {questions.map((question, index) => (
          <article className="card answersQuestionCard" key={question.id || `${question.sourceId}-${index}`}>
            <div className="answersQuestionCardHead">
              <div className="answersQuestionCardTitle">{questionKeyLabel(index)}</div>
              <span className="badge">{question.hasImage ? "Rasmli" : "Rasmsiz"}</span>
            </div>

            <div className="answersQuestionTextBig">{question.text}</div>

            {question.image ? (
              <div className="answersQuestionImageWrap">
                <img className="answersQuestionImage" src={resolveQuestionImage(question.image)} alt={question.text} />
              </div>
            ) : null}

            <div className="answersOptions">
              {question.options.map((option, optionIndex) => {
                const correct = optionIndex === question.correctIndex;
                return (
                  <div key={`${question.id}-${optionIndex}`} className={`option ${correct ? "correct" : ""}`}>
                    <div className="optionKey">{String.fromCharCode(65 + optionIndex)}</div>
                    <div className="optionText">{option}</div>
                  </div>
                );
              })}
            </div>

            {question.explanation ? <div className="answersExplanation">{question.explanation}</div> : null}
          </article>
        ))}
      </div>

      {answersQuery.hasNextPage ? (
        <div style={{ display: "flex", justifyContent: "center", marginTop: 12 }}>
          <button className="btn btn-ghost" type="button" onClick={() => answersQuery.fetchNextPage()} disabled={isLoadingMore}>
            {isLoadingMore ? "Yuklanmoqda..." : "Ko‘proq yuklash"}
          </button>
        </div>
      ) : null}
    </section>
  );
}
