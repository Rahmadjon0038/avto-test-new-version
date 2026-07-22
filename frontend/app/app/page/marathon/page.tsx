"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { ArrowLeft, ChevronLeft, ChevronRight, Flag, RotateCcw, Flame } from "lucide-react";
import { Cell, Pie, PieChart } from "recharts";
import { useAuth } from "@/app/auth-provider";
import { useSiteLanguage } from "@/app/site-language-provider";
import { jsonOrError } from "@/lib/api-authed";
import { useArrowQuestionNavigation } from "@/lib/use-arrow-question-navigation";
import { useTestInteractions } from "@/lib/test-interactions";

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

const PAGE_SIZE = 20;
const FALLBACK_IMAGE = "/default.png";

function resolveQuestionImage(image?: string) {
  const value = String(image || "").trim();
  if (!value) return FALLBACK_IMAGE;
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

export default function MarathonPage() {
  const router = useRouter();
  const { authFetch } = useAuth();
  const { t } = useSiteLanguage();
  const questionCardRef = useRef<HTMLDivElement | null>(null);
  const autoNextTimerRef = useRef<number | null>(null);

  const [bank, setBank] = useState<AnswerQuestion[]>([]);
  const [visibleQuestions, setVisibleQuestions] = useState<AnswerQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [currentIndex, setCurrentIndex] = useState(0);
  const [nextBankIndex, setNextBankIndex] = useState(3);
  const [hasMoreBank, setHasMoreBank] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [imageLoading, setImageLoading] = useState(true);
  const [zoomedImage, setZoomedImage] = useState<string | null>(null);
  const [finishOpen, setFinishOpen] = useState(false);

  const currentQuestion = visibleQuestions[currentIndex] ?? null;

  const total = visibleQuestions.length;
  const answered = Object.keys(answers).length;
  const correctCount = visibleQuestions.filter(
    (question) => answers[question.id] !== undefined && Number(answers[question.id]) === Number(question.correctIndex)
  ).length;
  const percent = total > 0 ? Math.round((correctCount / total) * 100) : 0;
  const chartData = [
    { name: "To‘g‘ri", value: correctCount },
    { name: "Qolgan", value: Math.max(total - correctCount, 0) }
  ];

  const loadNextBankPage = useCallback(async () => {
    if (isLoadingMore || !hasMoreBank) return [] as AnswerQuestion[];
    setIsLoadingMore(true);
    try {
      const params = new URLSearchParams({
        offset: String(bank.length),
        limit: String(PAGE_SIZE)
      });
      const res = await authFetch(`/api/answers?${params.toString()}`);
      const data = await jsonOrError(res);
      const fetched = Array.isArray(data.questions)
        ? (data.questions as AnswerQuestion[])
        : [];
      setBank((prev) => [...prev, ...fetched]);
      setHasMoreBank(Boolean(data.hasMore));
      return fetched;
    } finally {
      setIsLoadingMore(false);
    }
  }, [authFetch, bank.length, hasMoreBank, isLoadingMore]);

  const loadInitial = useCallback(async () => {
    setIsLoading(true);
    setBank([]);
    setVisibleQuestions([]);
    setAnswers({});
    setCurrentIndex(0);
    setNextBankIndex(3);
    setHasMoreBank(true);

    try {
      const params = new URLSearchParams({
        offset: "0",
        limit: String(PAGE_SIZE)
      });
      const res = await authFetch(`/api/answers?${params.toString()}`);
      const data = await jsonOrError(res);
      const fetched = Array.isArray(data.questions) ? (data.questions as AnswerQuestion[]) : [];
      if (!fetched.length) {
        setBank([]);
        setVisibleQuestions([]);
        setHasMoreBank(Boolean(data.hasMore));
        return;
      }
      setBank(fetched);
      setHasMoreBank(Boolean(data.hasMore));
      setVisibleQuestions(fetched.slice(0, Math.min(3, fetched.length)));
      setNextBankIndex(Math.min(3, fetched.length));
    } catch (error: any) {
      toast.error(error?.message || "Marafon yuklanmadi");
    } finally {
      setIsLoading(false);
    }
  }, [authFetch]);

  useEffect(() => {
    void loadInitial();
  }, [loadInitial]);

  useEffect(() => {
    return () => {
      if (autoNextTimerRef.current) window.clearTimeout(autoNextTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!hasMoreBank || isLoadingMore) return;
    if (bank.length - nextBankIndex > 2) return;
    void loadNextBankPage();
  }, [bank.length, hasMoreBank, isLoadingMore, loadNextBankPage, nextBankIndex]);

  useEffect(() => {
    setImageLoading(Boolean(currentQuestion?.image));
  }, [currentQuestion?.id, currentQuestion?.image]);

  const currentAnswered = Boolean(currentQuestion && answers[currentQuestion.id] !== undefined);
  useArrowQuestionNavigation({
    enabled: Boolean(currentQuestion) && !zoomedImage && !finishOpen,
    onPrevious: () => {
      if (currentIndex > 0) setCurrentIndex((current) => Math.max(0, current - 1));
    },
    onNext: () => {
      if (currentIndex < total - 1) setCurrentIndex((current) => Math.min(total - 1, current + 1));
    }
  });

  async function ensureNextQuestionLoaded() {
    if (nextBankIndex < bank.length) return bank[nextBankIndex];
    const fetched = await loadNextBankPage();
    return fetched[0] ?? null;
  }

  function scheduleAutoNext(nextIndex: number) {
    if (autoNextTimerRef.current) window.clearTimeout(autoNextTimerRef.current);
    autoNextTimerRef.current = window.setTimeout(() => {
      setCurrentIndex((cur) => {
        if (cur !== nextIndex - 1) return cur;
        return nextIndex;
      });
    }, 900);
  }

  async function handleAnswer(optionIndex: number) {
    if (!currentQuestion) return;
    if (answers[currentQuestion.id] !== undefined) return;

    const nextAnswers = { ...answers, [currentQuestion.id]: optionIndex };
    setAnswers(nextAnswers);

    const isCorrect = optionIndex === currentQuestion.correctIndex;
    if (isCorrect) {
      const nextQuestion = await ensureNextQuestionLoaded();
      if (nextQuestion) {
        setVisibleQuestions((prev) => [...prev, nextQuestion]);
        setNextBankIndex((prev) => prev + 1);
      }

      scheduleAutoNext(currentIndex + 1);
      return;
    }

    if (currentIndex < visibleQuestions.length - 1) {
      scheduleAutoNext(currentIndex + 1);
    }
  }

  useTestInteractions({
    enabled: Boolean(currentQuestion) && !currentAnswered && !zoomedImage && !finishOpen,
    currentIndex,
    optionCount: currentQuestion?.options.length || 0,
    mode: "function",
    onSelect: (optionIndex) => {
      void handleAnswer(optionIndex);
    },
    scrollTargetRef: questionCardRef
  });

  if (isLoading) {
    return (
      <section className="view">
        <div className="muted">{t("marathon.loading")}</div>
      </section>
    );
  }

  if (!visibleQuestions.length) {
    return (
      <section className="view">
        <div className="sectionTopBar" style={{ marginBottom: 12 }}>
          <button className="btn btn-ghost btn-sm" type="button" onClick={() => router.push("/app")}>
            <ArrowLeft className="lucide" aria-hidden="true" /> {t("common.back")}
          </button>
        </div>
        <div className="card" style={{ padding: 18 }}>
          <div className="h2" style={{ margin: 0 }}>
            {t("marathon.title")}
          </div>
          <div className="muted" style={{ marginTop: 8 }}>
            {t("marathon.empty")}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="view">
      <div
        className="sectionTopBar"
        style={{
          marginBottom: 12,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          width: "100%",
          gap: 12
        }}
      >
        <button className="btn btn-ghost btn-sm" type="button" onClick={() => router.push("/app")}>
          <ArrowLeft className="lucide" aria-hidden="true" /> {t("common.back")}
        </button>
        <button
          className="btn btn-danger btn-sm"
          type="button"
          onClick={() => {
            setFinishOpen(false);
            loadInitial();
          }}
        >
          <RotateCcw className="lucide" aria-hidden="true" /> {t("marathon.restart")}
        </button>
      </div>

      <div className="topicsHero card marathonHero">
        <div className="answersHeroLeft">
          <div className="answersHeroIcon">
            <Flame className="lucide" aria-hidden="true" />
          </div>
          <div>
            <div className="topicsTitle">{t("marathon.title")}</div>
            <div className="topicsSub">{t("marathon.answerCount", { answered, total })}</div>
          </div>
        </div>
        <div className="answersHeroMeta">
          <span className="badge">{t("marathon.correctLabel")} {correctCount}</span>
        </div>
      </div>

      <div style={{ height: 14 }} />

      <div className="card" ref={questionCardRef}>
        <div className="qTitleBar">{currentQuestion.text}</div>
        <div className="qLayout">
          <div className="qRight">
            <div className="options">
              {currentQuestion.options.map((option, optionIndex) => {
                const selected = answers[currentQuestion.id];
                const hasAnswered = selected !== undefined;
                const correct = optionIndex === currentQuestion.correctIndex;
                const wrong = hasAnswered && optionIndex === selected && !correct;
                return (
                  <button
                    key={optionIndex}
                    className={`option ${hasAnswered && correct ? "correct" : ""} ${wrong ? "wrong" : ""}`}
                    type="button"
                    disabled={hasAnswered}
                    onClick={() => void handleAnswer(optionIndex)}
                  >
                    <span className="optionKey">F{optionIndex + 1}</span>
                    <span className="optionText">{option}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="qLeft">
            {imageLoading ? (
              <div className="qImageLoader" aria-label="Rasm yuklanmoqda">
                <span className="qSpinner" />
              </div>
            ) : null}
            <button
              className="imageZoomTrigger"
              type="button"
              onClick={() => setZoomedImage(resolveQuestionImage(currentQuestion.image))}
              aria-label="Rasmni kattalashtirish"
            >
              <img
                className={`qimg ${imageLoading ? "isLoading" : ""}`}
                src={resolveQuestionImage(currentQuestion.image)}
                alt="Savol rasmi"
                onLoad={() => setImageLoading(false)}
                onError={(event) => {
                  const img = event.currentTarget;
                  setImageLoading(false);
                  if (img.src !== FALLBACK_IMAGE) img.src = FALLBACK_IMAGE;
                }}
              />
            </button>
          </div>
        </div>
      </div>

      <div className="qnav">
        {visibleQuestions.map((question, index) => {
          const selected = answers[question.id];
          const hasAnswered = selected !== undefined;
          const isWrong = hasAnswered && Number(selected) !== Number(question.correctIndex);
          const isCorrect = hasAnswered && Number(selected) === Number(question.correctIndex);
          return (
            <button
              key={question.id}
              className={`qbtn ${index === currentIndex ? "active" : ""} ${isCorrect ? "answered correct" : ""} ${isWrong ? "answered wrong" : ""} ${hasAnswered && !isWrong && !isCorrect ? "answered" : ""}`}
              type="button"
              onClick={() => setCurrentIndex(index)}
            >
              {index + 1}
            </button>
          );
        })}
      </div>

      <div className="topicFooter">
        <div className="footerLeft">
          <button className="btn btn-ghost" type="button" onClick={() => setCurrentIndex(Math.max(0, currentIndex - 1))} disabled={currentIndex <= 0}>
            <ChevronLeft className="lucide" aria-hidden="true" /> {t("common.back")}
          </button>
          <button className="btn btn-ghost" type="button" onClick={() => setCurrentIndex(Math.min(visibleQuestions.length - 1, currentIndex + 1))} disabled={currentIndex >= visibleQuestions.length - 1}>
            {t("common.next")} <ChevronRight className="lucide" aria-hidden="true" />
          </button>
        </div>
        <div className="footerRight">
          <button className="btn btn-primary" type="button" onClick={() => setFinishOpen(true)}>
            <Flag className="lucide" aria-hidden="true" /> {t("marathon.finish")}
          </button>
        </div>
      </div>

      {finishOpen ? (
        <>
          <div className="modalOverlay" onClick={() => router.push("/app")} />
          <div className="modal modalResult" role="dialog" aria-modal="true">
            <div className="modalHeader">
              <div className="modalTitle">{t("marathon.resultTitle")}</div>
              <button className="btn btn-ghost" type="button" onClick={() => router.push("/app")}>
                ✕
              </button>
            </div>
            <div className="modalBody modalBodyResult">
              <div className="finishStats finishStatsResult">
                <div className="chartBlock">
                  <div className="chartWrap" aria-hidden="true">
                    <PieChart width={220} height={220} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
                      <Pie
                        data={chartData}
                        dataKey="value"
                        cx="50%"
                        cy="50%"
                        innerRadius={72}
                        outerRadius={96}
                        startAngle={90}
                        endAngle={-270}
                        paddingAngle={0}
                        stroke="none"
                        cornerRadius={8}
                      >
                        <Cell fill="#2f6dff" />
                        <Cell fill="rgba(255, 255, 255, 0.09)" />
                      </Pie>
                    </PieChart>
                    <div className="chartCenter">
                      <div className="chartValue">{percent}%</div>
                      <div className="chartLabel">{t("progress.title")}</div>
                    </div>
                  </div>
                  <div className="chartMeta">
                    <div className="muted">{t("progress.title")}</div>
                    <div className="chartCount">{correctCount}/{visibleQuestions.length}</div>
                  </div>
                </div>
              </div>
              <button className="btn btn-primary" type="button" onClick={() => router.push("/app")}>
                {t("publicRunner.finishButton")}
              </button>
            </div>
          </div>
        </>
      ) : null}

      {zoomedImage ? (
        <div className="imageLightbox" role="dialog" aria-modal="true" onClick={() => setZoomedImage(null)}>
          <button className="imageLightboxClose" type="button" onClick={() => setZoomedImage(null)} aria-label="Yopish">
            ×
          </button>
          <img className="imageLightboxImg" src={zoomedImage} alt="Katta rasm" onClick={(event) => event.stopPropagation()} />
        </div>
      ) : null}
    </section>
  );
}
