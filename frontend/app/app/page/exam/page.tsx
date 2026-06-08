"use client";

import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { ArrowLeft, ChevronLeft, ChevronRight, Flag, RotateCcw, TimerReset } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/app/auth-provider";
import { jsonOrError } from "@/lib/api-authed";
import { useTestInteractions } from "@/lib/test-interactions";

type ExamQuestion = {
  id: string;
  kind: "ticket" | "topic" | "custom" | string;
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

type ExamData = {
  questions: ExamQuestion[];
  answers: Record<string, number>;
  completed: boolean;
  score: number;
  updatedAt: string | null;
  examCount: number;
  durationSeconds: number;
  startedAt: string;
  expiresAt: string;
  remainingSeconds: number;
  expired: boolean;
};

type ModeCount = 20;

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
      // proxy fallback below
    }
    return `/api/image?u=${encodeURIComponent(value)}`;
  }
  return value;
}

function isSafeHref(href: string) {
  return /^(https?:\/\/|\/)/i.test(href.trim());
}

function renderInlineMarkdown(text: string, prefix = "md-inline"): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(\*\*[\s\S]+?\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\)|\*[^*\n]+\*)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let keyIndex = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index));

    const token = match[0];
    const key = `${prefix}-${keyIndex++}`;

    if (token.startsWith("**") && token.endsWith("**")) {
      nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("`") && token.endsWith("`")) {
      nodes.push(
        <code key={key} className="markdownInlineCode">
          {token.slice(1, -1)}
        </code>
      );
    } else if (token.startsWith("[") && token.includes("](") && token.endsWith(")")) {
      const splitAt = token.indexOf("](");
      const label = token.slice(1, splitAt);
      const href = token.slice(splitAt + 2, -1);
      if (isSafeHref(href)) {
        nodes.push(
          <a key={key} className="markdownLink" href={href} target="_blank" rel="noreferrer">
            {label}
          </a>
        );
      } else {
        nodes.push(token);
      }
    } else if (token.startsWith("*") && token.endsWith("*")) {
      nodes.push(<em key={key}>{token.slice(1, -1)}</em>);
    } else {
      nodes.push(token);
    }

    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

function renderMarkdown(text: string): ReactNode[] {
  const normalized = String(text || "").replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];

  const lines = normalized.split("\n");
  const blocks: ReactNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();

    if (!trimmed) {
      index += 1;
      continue;
    }

    if (trimmed.startsWith("```")) {
      index += 1;
      const codeLines: string[] = [];
      while (index < lines.length && !lines[index].trim().startsWith("```")) {
        codeLines.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push(
        <pre key={`md-block-${blocks.length}`} className="markdownCodeBlock">
          <code>{codeLines.join("\n")}</code>
        </pre>
      );
      continue;
    }

    const paragraphLines: string[] = [line];
    index += 1;
    while (index < lines.length) {
      const next = lines[index];
      const nextTrimmed = next.trim();
      if (!nextTrimmed || nextTrimmed.startsWith("```")) break;
      paragraphLines.push(next);
      index += 1;
    }

    blocks.push(
      <p key={`md-block-${blocks.length}`} className="markdownParagraph">
        {paragraphLines.map((paragraphLine, paragraphIndex) => (
          <Fragment key={paragraphIndex}>
            {renderInlineMarkdown(paragraphLine, `md-p-${blocks.length}-${paragraphIndex}`)}
            {paragraphIndex < paragraphLines.length - 1 ? <br /> : null}
          </Fragment>
        ))}
      </p>
    );
  }

  return blocks;
}

function MarkdownText({ text }: { text: string }) {
  const blocks = useMemo(() => renderMarkdown(text), [text]);
  if (!blocks.length) return null;
  return <div className="markdownContent">{blocks}</div>;
}

function formatTime(totalSeconds: number) {
  const safe = Math.max(0, totalSeconds);
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function uzErrorMessage(error: unknown, fallback: string) {
  const message = String((error as any)?.message || "").trim();
  if (!message) return fallback;
  if (message === "Xatolik") return fallback;
  return message;
}

function examFinishedToast() {
  toast.error("Imtihon yakunlangan. Qayta boshlash uchun \"Qayta boshlash\" tugmasini bosing.");
}

function calculateExamResult(
  questionList: ExamQuestion[],
  selectedAnswers: Record<string, number>
) {
  const total = questionList.length;
  const correct = questionList.reduce((count, question) => {
    const selected = selectedAnswers[question.id];
    return count + (selected !== undefined && Number(selected) === Number(question.correctIndex) ? 1 : 0);
  }, 0);
  const wrong = Math.max(0, total - correct);
  const percent = total > 0 ? Math.round((correct / total) * 100) : 0;
  return { correct, wrong, total, percent };
}

export default function ExamPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const { authFetch, authReady } = useAuth();

  const [idx, setIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [finishOpen, setFinishOpen] = useState(false);
  const [finalResult, setFinalResult] = useState<{ correct: number; wrong: number; total: number; percent: number } | null>(null);
  const [imageLoading, setImageLoading] = useState(true);
  const [zoomedImage, setZoomedImage] = useState<string | null>(null);
  const [timerReady, setTimerReady] = useState(false);
  const [autoStartAttempted, setAutoStartAttempted] = useState(false);
  const [examBootstrapping, setExamBootstrapping] = useState(false);
  const autoNextTimerRef = useRef<number | null>(null);
  const questionCardRef = useRef<HTMLDivElement | null>(null);
  const autoStartRequestedRef = useRef(false);
  const autoSubmittedRef = useRef(false);
  const activeExamKeyRef = useRef<string | null>(null);
  const latestAnswersRef = useRef<Record<string, number>>({});
  const hasSeenPositiveTimerRef = useRef(false);

  const examQuery = useQuery({
    queryKey: ["exam"],
    queryFn: async () => {
      const res = await authFetch("/api/exam");
      const data = await jsonOrError(res);
      return (data.exam || null) as ExamData | null;
    }
  });

  useEffect(() => {
    if (examQuery.error) toast.error(uzErrorMessage(examQuery.error, "Imtihon ma'lumotlari yuklanmadi"));
  }, [examQuery.error]);

  const exam = examQuery.data || null;
  const questions = exam?.questions || [];
  const currentQuestion = questions[idx] || null;
  const completed = Boolean(exam?.completed);
  const expired = Boolean(exam?.expired);
  const locked = completed || expired || finalResult !== null;
  const draftScore = questions.reduce((total, question) => {
    const selected = answers[question.id];
    return total + (selected !== undefined && Number(selected) === Number(question.correctIndex) ? 1 : 0);
  }, 0);
  const chartPercent = finalResult?.percent ?? 0;
  const currentAnswered = Boolean(currentQuestion && answers[currentQuestion.id] !== undefined);

  useTestInteractions({
    enabled: Boolean(currentQuestion) && !currentAnswered && !zoomedImage && !locked,
    currentIndex: idx,
    optionCount: currentQuestion?.options.length || 0,
    mode: "alpha",
    onSelect: (optionIndex) => {
      if (!currentQuestion || locked) return;
      const nextAnswers = { ...answers, [currentQuestion.id]: optionIndex };
      save(nextAnswers);
      if (idx < questions.length - 1) scheduleAutoNext(idx + 1);
    },
    scrollTargetRef: questionCardRef
  });

  useEffect(() => {
    if (!exam) return;
    setExamBootstrapping(false);
    setAutoStartAttempted(true);
    const nextExamKey = `${exam.startedAt}::${exam.examCount}`;
    const isNewSession = activeExamKeyRef.current !== nextExamKey;
    activeExamKeyRef.current = nextExamKey;
    latestAnswersRef.current = exam.answers || {};
    hasSeenPositiveTimerRef.current = Number(exam.remainingSeconds || 0) > 0;
    setAnswers(exam.answers || {});
    setSecondsLeft(Number(exam.remainingSeconds || 0));
    setTimerReady(true);
    autoSubmittedRef.current = false;
    if (typeof window !== "undefined") {
      const savedIndexRaw = window.localStorage.getItem(`exam:index:${nextExamKey}`);
      const savedIndex = savedIndexRaw === null ? 0 : Number(savedIndexRaw);
      if (Number.isFinite(savedIndex)) {
        setIdx(Math.max(0, Math.min(savedIndex, Math.max(0, questions.length - 1))));
      } else {
        setIdx(0);
      }
    } else if (isNewSession) {
      setIdx(0);
    }
  }, [exam?.updatedAt, exam?.startedAt, exam?.examCount, questions.length]);

  function scheduleAutoNext(nextIndex: number) {
    if (autoNextTimerRef.current) window.clearTimeout(autoNextTimerRef.current);
    autoNextTimerRef.current = window.setTimeout(() => {
      setIdx((cur) => {
        if (cur !== nextIndex - 1) return cur;
        return nextIndex;
      });
    }, 550);
  }

  useEffect(() => {
    return () => {
      if (autoNextTimerRef.current) window.clearTimeout(autoNextTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!questions.length) return;
    setIdx((current) => Math.min(current, questions.length - 1));
  }, [questions.length]);

  useEffect(() => {
    if (!exam?.expiresAt || locked) return;
    setTimerReady(false);
    const updateRemaining = () => {
      const next = Math.max(0, Math.ceil((new Date(exam.expiresAt).getTime() - Date.now()) / 1000));
      if (next > 0) hasSeenPositiveTimerRef.current = true;
      setSecondsLeft(next);
    };
    updateRemaining();
    setTimerReady(true);
    const timer = window.setInterval(updateRemaining, 1000);
    return () => window.clearInterval(timer);
  }, [exam?.expiresAt, locked]);

  useEffect(() => {
    setImageLoading(Boolean(currentQuestion?.image));
  }, [currentQuestion?.id, currentQuestion?.image]);

  useEffect(() => {
    if (!zoomedImage) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setZoomedImage(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [zoomedImage]);

  useEffect(() => {
    if (!exam || completed || locked) {
      autoSubmittedRef.current = false;
      return;
    }
    if (examBootstrapping) return;
    if (!timerReady) return;
    if (!hasSeenPositiveTimerRef.current) return;
    if (secondsLeft > 0) return;
    if (autoSubmittedRef.current) return;
    autoSubmittedRef.current = true;
    saveMutation.mutate({ answers, finalize: true });
  }, [answers, completed, exam, examBootstrapping, locked, secondsLeft, timerReady]);

  const startMutation = useMutation({
    mutationFn: (nextCount: ModeCount) =>
      authFetch("/api/exam/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ count: nextCount })
      }).then(jsonOrError),
    onError: (error: any) => {
      setExamBootstrapping(false);
      toast.error(uzErrorMessage(error, "Imtihonni boshlashda xatolik"));
    },
    onSuccess: async (data: any) => {
      if (data?.exam) {
        qc.setQueryData(["exam"], data.exam);
      } else {
        await qc.invalidateQueries({ queryKey: ["exam"] });
        await examQuery.refetch();
      }
      setIdx(0);
      setFinalResult(null);
      setFinishOpen(false);
      setExamBootstrapping(false);
      hasSeenPositiveTimerRef.current = false;
      toast.success("Imtihon boshlandi");
    }
  });

  const saveMutation = useMutation<
    any,
    Error,
    { answers: Record<string, number>; finalize?: boolean; previousAnswers?: Record<string, number> }
  >({
    mutationFn: (payload: { answers: Record<string, number>; finalize?: boolean; previousAnswers?: Record<string, number> }) =>
      authFetch("/api/exam/progress", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      }).then(jsonOrError),
    onError: (error: any, variables: { previousAnswers?: Record<string, number> } | undefined) => {
      if (variables?.previousAnswers) setAnswers(variables.previousAnswers);
      toast.error(uzErrorMessage(error, "Javoblarni saqlashda xatolik"));
    },
    onSuccess: async (_data: any, variables) => {
      await qc.invalidateQueries({ queryKey: ["exam"] });
      await examQuery.refetch();
      if (variables?.finalize) {
        const serverTotal = Number(_data?.total);
        const serverScore = Number(_data?.score);
        const fallbackResult = calculateExamResult(questions, latestAnswersRef.current);
        const useServer =
          Number.isFinite(serverTotal) &&
          serverTotal > 0 &&
          Number.isFinite(serverScore) &&
          (serverScore > 0 || fallbackResult.correct === 0);
        const total = useServer ? serverTotal : fallbackResult.total;
        const correct = useServer ? serverScore : fallbackResult.correct;
        const wrong = Math.max(0, total - correct);
        const percent = total > 0 ? Math.round((correct / total) * 100) : 0;
        setFinalResult({ correct, wrong, total, percent });
        setFinishOpen(true);
        toast.success("Imtihon yakunlandi");
      }
    }
  });

  const canFinalize = Boolean(exam && !completed && !expired && !examBootstrapping && !saveMutation.isPending);

  const resetMutation = useMutation({
    mutationFn: () => authFetch("/api/exam/reset", { method: "POST" }).then(jsonOrError),
    onMutate: async () => {
      setExamBootstrapping(true);
      setFinishOpen(false);
      setFinalResult(null);
      setAnswers({});
      latestAnswersRef.current = {};
      setIdx(0);
      setSecondsLeft(0);
      setAutoStartAttempted(true);
      activeExamKeyRef.current = null;
      hasSeenPositiveTimerRef.current = false;
      await qc.invalidateQueries({ queryKey: ["exam"] });
    },
    onError: () => {
      setExamBootstrapping(false);
    },
    onSuccess: () => {
      toast.success("Imtihon qayta boshlanmoqda...");
      window.location.reload();
    }
  });

  function save(nextAnswers: Record<string, number>) {
    const previousAnswers = answers;
    latestAnswersRef.current = nextAnswers;
    setAnswers(nextAnswers);
    saveMutation.mutate({ answers: nextAnswers, finalize: false, previousAnswers });
  }

  useEffect(() => {
    if (!authReady) return;
    if (!examQuery.isFetched) return;
    if (autoStartAttempted || autoStartRequestedRef.current) return;
    autoStartRequestedRef.current = true;
    setExamBootstrapping(true);
    setAutoStartAttempted(true);
    setFinishOpen(false);
    setFinalResult(null);
    setAnswers({});
    latestAnswersRef.current = {};
    setIdx(0);
    startMutation.mutate(20);
  }, [authReady, examQuery.isFetched, autoStartAttempted, startMutation]);

  useEffect(() => {
    if (!exam || !exam.startedAt || locked) return;
    if (typeof window === "undefined") return;
    window.localStorage.setItem(`exam:index:${exam.startedAt}::${exam.examCount}`, String(idx));
  }, [exam, idx, locked]);

  const showExamLoading =
    !exam &&
    (examQuery.isLoading || !authReady || startMutation.isPending || resetMutation.isPending || examBootstrapping || !autoStartAttempted);

  if (showExamLoading) {
    return (
      <section className="view examLoadingView">
        <div className="examLoadingCard">
          <div className="examLoadingSpinnerWrap">
            <span className="examLoadingSpinner" />
          </div>
          <div className="examLoadingTitle">Imtihon boshlanmoqda</div>
          <div className="examLoadingText">Savollar tayyorlanmoqda, biroz kuting...</div>
        </div>
      </section>
    );
  }

  return (
    <section className="view examView">
      <div className="topicHeader examHeader">
        <div className="topicHeaderLeft">
          <button className="btn btn-ghost btn-sm" type="button" onClick={() => router.push("/app")}>
            <ArrowLeft className="lucide" aria-hidden="true" /> Orqaga
          </button>
          <div>
            <div className="h2" style={{ margin: 0 }}>
              Imtihon topshirish
            </div>
          </div>
        </div>

        <div className="examTimerChip">
          <TimerReset className="lucide" aria-hidden="true" />
          <span>{formatTime(secondsLeft)}</span>
        </div>
      </div>

      {(completed || expired) && (
        <div className="card examResultBanner">
          <div>
            <div className="h2" style={{ margin: 0 }}>
              {completed ? "Imtihon yakunlandi" : "Vaqt tugadi"}
            </div>
            <div className="muted">
              {exam?.score || 0} ta to‘g‘ri · {questions.length} ta savol
            </div>
          </div>
          <button className="btn btn-primary" type="button" onClick={() => resetMutation.mutate()} disabled={resetMutation.isPending}>
            {resetMutation.isPending ? "O‘chirilmoqda..." : "Yangi imtihon"}
          </button>
        </div>
      )}

      <div className="qnav">
        {questions.map((question, questionIndex) => (
          (() => {
            const selected = answers[question.id];
            const hasAnswered = selected !== undefined;
            const isWrong = hasAnswered && Number(selected) !== Number(question.correctIndex);
            const isCorrect = hasAnswered && Number(selected) === Number(question.correctIndex);
            return (
          <button
            key={question.id}
            className={`qbtn ${questionIndex === idx ? "active" : ""} ${isCorrect ? "answered correct" : ""} ${isWrong ? "answered wrong" : ""} ${hasAnswered && !isWrong && !isCorrect ? "answered" : ""}`}
            type="button"
            onClick={() => setIdx(questionIndex)}
          >
            {questionIndex + 1}
          </button>
            );
          })()
        ))}
      </div>

      {currentQuestion ? (
        <div className="card" ref={questionCardRef}>
          <div className="qTitleBar">
            <div>{currentQuestion.text}</div>
          </div>

          <div className="qLayout">
            <div className="qRight">
              <div className="options">
                {currentQuestion.options.map((opt, optionIndex) => {
                  const selected = answers[currentQuestion.id];
                  const hasAnswered = selected !== undefined;
                  const correct = optionIndex === currentQuestion.correctIndex;
                  const wrong = hasAnswered && optionIndex === selected && !correct;
                  return (
                    <button
                      key={optionIndex}
                      className={`option ${hasAnswered && correct ? "correct" : ""} ${wrong ? "wrong" : ""} ${locked ? "locked" : ""}`}
                      type="button"
                      disabled={hasAnswered}
                      onClick={() => {
                        if (locked) {
                          examFinishedToast();
                          return;
                        }
                        if (hasAnswered) return;
                        const nextAnswers = { ...answers, [currentQuestion.id]: optionIndex };
                        save(nextAnswers);
                        if (idx < questions.length - 1) scheduleAutoNext(idx + 1);
                      }}
                    >
                      <span className="optionKey">{String.fromCharCode(65 + optionIndex)}</span>
                      <span className="optionText">{opt}</span>
                    </button>
                  );
                })}
              </div>

            </div>

            <div className="qLeft">
              {imageLoading && (
                <div className="qImageLoader" aria-label="Rasm yuklanmoqda">
                  <span className="qSpinner" />
                </div>
              )}
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
      ) : null}

      <div className="topicFooter">
        <div className="footerLeft">
          <button className="btn btn-danger btn-sm examResetBtn" type="button" onClick={() => resetMutation.mutate()} disabled={resetMutation.isPending}>
            <RotateCcw className="lucide" aria-hidden="true" /> {resetMutation.isPending ? "Qayta boshlanmoqda..." : "Qayta boshlash"}
          </button>
        </div>
        <div className="footerCenter">
          <button className="btn btn-ghost" type="button" onClick={() => setIdx(Math.max(0, idx - 1))} disabled={idx <= 0 || locked}>
            <ChevronLeft className="lucide" aria-hidden="true" /> Orqaga
          </button>
          <button
            className="btn btn-ghost"
            type="button"
            onClick={() => setIdx(Math.min(questions.length - 1, idx + 1))}
            disabled={idx >= questions.length - 1 || locked}
          >
            Keyingi <ChevronRight className="lucide" aria-hidden="true" />
          </button>
        </div>
        <div className="footerRight">
          <button className="btn btn-primary" type="button" onClick={() => saveMutation.mutate({ answers, finalize: true })} disabled={!canFinalize}>
            <Flag className="lucide" aria-hidden="true" /> Yakunlash
          </button>
        </div>
      </div>

      {finishOpen && finalResult ? (
        <>
          <div className="modalOverlay" onClick={() => setFinishOpen(false)} />
          <div className="modal modalResult" role="dialog" aria-modal="true">
            <div className="modalHeader">
              <div className="modalTitle">Natija</div>
              <button className="btn btn-ghost" type="button" onClick={() => setFinishOpen(false)}>
                ✕
              </button>
            </div>
            <div className="modalBody">
              <div className="resultBlock resultChartBlock">
                <div className="resultChart">
                  <div className="resultSolved">
                    <div className="muted">Yechilgan</div>
                    <div className="resultSolvedValue">
                      {finalResult.correct}/{finalResult.total}
                    </div>
                  </div>
                  <div
                    className="resultChartRing"
                    style={{
                      background: `conic-gradient(var(--primary) 0 ${chartPercent}%, rgba(255, 255, 255, 0.12) ${chartPercent}% 100%)`
                    }}
                  >
                    <div className="resultChartCenter">
                    <div className="resultChartValue">{finalResult.percent}%</div>
                    <div className="resultChartLabel">Foiz</div>
                    </div>
                  </div>
                </div>
              </div>
              <button className="btn btn-primary resultCloseBtn" type="button" onClick={() => setFinishOpen(false)}>
                Yopish
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
