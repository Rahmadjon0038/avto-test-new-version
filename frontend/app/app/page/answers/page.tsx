"use client";

import { useEffect, useMemo, useState } from "react";
import { BookOpen, Filter, Image, ImageOff, Search } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
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

  const answersQuery = useQuery({
    queryKey: ["answers"],
    queryFn: async () => {
      const res = await authFetch("/api/answers");
      const data = await jsonOrError(res);
      return Array.isArray(data.questions) ? data.questions : [];
    }
  });

  useEffect(() => {
    if (answersQuery.error) toast.error((answersQuery.error as any)?.message || "Xatolik");
  }, [answersQuery.error]);

  const questions = (answersQuery.data || []) as AnswerQuestion[];

  const filteredQuestions = useMemo(() => {
    let output = questions;
    if (filter === "with-image") output = output.filter((question) => question.hasImage);
    if (filter === "without-image") output = output.filter((question) => !question.hasImage);

    const query = search.trim().toLowerCase();
    if (!query) return output;

    return output.filter((question) => {
      const text = String(question.text || "").toLowerCase();
      const source = String(question.sourceTitle || "").toLowerCase();
      const answer = String(question.correctAnswer || "").toLowerCase();
      const explanation = String(question.explanation || "").toLowerCase();
      return text.includes(query) || source.includes(query) || answer.includes(query) || explanation.includes(query);
    });
  }, [filter, questions, search]);

  const counts = useMemo(
    () => ({
      all: questions.length,
      withImage: questions.filter((question) => question.hasImage).length,
      withoutImage: questions.filter((question) => !question.hasImage).length
    }),
    [questions]
  );

  return (
    <section className="view">
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
          <span className="badge">{counts.withImage} ta rasmli</span>
          <span className="badge">{counts.withoutImage} ta rasmsiz</span>
        </div>
      </div>

      <div className="answersFilters">
        <button className={`answersFilter ${filter === "all" ? "active" : ""}`} type="button" onClick={() => setFilter("all")}>
          <Filter className="lucide" aria-hidden="true" />
          <span>{resolveFilterLabel("all")}</span>
          <span className="badge">{counts.all}</span>
        </button>
        <button className={`answersFilter ${filter === "with-image" ? "active" : ""}`} type="button" onClick={() => setFilter("with-image")}>
          <Image className="lucide" aria-hidden="true" />
          <span>{resolveFilterLabel("with-image")}</span>
          <span className="badge">{counts.withImage}</span>
        </button>
        <button className={`answersFilter ${filter === "without-image" ? "active" : ""}`} type="button" onClick={() => setFilter("without-image")}>
          <ImageOff className="lucide" aria-hidden="true" />
          <span>{resolveFilterLabel("without-image")}</span>
          <span className="badge">{counts.withoutImage}</span>
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

      {answersQuery.isLoading ? <div className="muted">Savollar yuklanmoqda...</div> : null}

      {!answersQuery.isLoading && filteredQuestions.length === 0 ? (
        <section className="card answersEmpty">
          <div className="adminEmptyTitle">Hech narsa topilmadi</div>
          <div className="adminEmptyText">Tanlangan filtr bo‘yicha savol yo‘q.</div>
        </section>
      ) : null}

      <div className="answersQuestionGrid">
        {filteredQuestions.map((question, index) => (
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
    </section>
  );
}
