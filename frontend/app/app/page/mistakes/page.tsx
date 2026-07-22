"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { ArrowLeft, ChevronLeft, ChevronRight, Flag, List, RotateCcw, Target, Trash2 } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/app/auth-provider";
import { useSiteLanguage } from "@/app/site-language-provider";
import { jsonOrError } from "@/lib/api-authed";
import { QuestionAudio } from "@/lib/question-audio";
import { TestPageSettingsButton, shuffleQuestionsWithSeed, useShuffleSeed, useTestPageSettings } from "@/lib/test-page-settings";
import { useTestInteractions } from "@/lib/test-interactions";

type MistakeQuestion = {
  id: string;
  kind: "ticket" | "topic" | "custom" | string;
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
  wrongAnswer: number | null;
};

type TabKey = "list" | "practice";

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

    if (/^#{1,6}\s+/.test(trimmed)) {
      const level = Math.min(trimmed.match(/^#+/)?.[0].length || 1, 6);
      const content = trimmed.replace(/^#{1,6}\s+/, "");
      const heading = renderInlineMarkdown(content, `md-h${blocks.length}`);
      if (level === 1) {
        blocks.push(
          <h1 key={`md-block-${blocks.length}`} className="markdownHeading">
            {heading}
          </h1>
        );
      } else if (level === 2) {
        blocks.push(
          <h2 key={`md-block-${blocks.length}`} className="markdownHeading">
            {heading}
          </h2>
        );
      } else if (level === 3) {
        blocks.push(
          <h3 key={`md-block-${blocks.length}`} className="markdownHeading">
            {heading}
          </h3>
        );
      } else if (level === 4) {
        blocks.push(
          <h4 key={`md-block-${blocks.length}`} className="markdownHeading">
            {heading}
          </h4>
        );
      } else if (level === 5) {
        blocks.push(
          <h5 key={`md-block-${blocks.length}`} className="markdownHeading">
            {heading}
          </h5>
        );
      } else {
        blocks.push(
          <h6 key={`md-block-${blocks.length}`} className="markdownHeading">
            {heading}
          </h6>
        );
      }
      index += 1;
      continue;
    }

    if (/^>\s?/.test(trimmed)) {
      const quoteLines: string[] = [];
      while (index < lines.length && /^>\s?/.test(lines[index].trim())) {
        quoteLines.push(lines[index].trim().replace(/^>\s?/, ""));
        index += 1;
      }
      blocks.push(
        <blockquote key={`md-block-${blocks.length}`} className="markdownQuote">
          {quoteLines.map((quoteLine, quoteIndex) => (
            <Fragment key={quoteIndex}>
              {renderInlineMarkdown(quoteLine, `md-q-${blocks.length}-${quoteIndex}`)}
              {quoteIndex < quoteLines.length - 1 ? <br /> : null}
            </Fragment>
          ))}
        </blockquote>
      );
      continue;
    }

    const paragraphLines: string[] = [line];
    index += 1;
    while (index < lines.length) {
      const next = lines[index];
      const nextTrimmed = next.trim();
      if (!nextTrimmed || nextTrimmed.startsWith("```") || /^#{1,6}\s+/.test(nextTrimmed) || /^>\s?/.test(nextTrimmed)) {
        break;
      }
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

function optionLetter(index: number) {
  return String.fromCharCode(65 + index);
}

function mistakeLabel(question: MistakeQuestion, index: number, t: (key: string) => string) {
  const kindLabel =
    question.kind === "ticket"
      ? t("mistakes.kindTicket")
      : question.kind === "topic"
        ? t("mistakes.kindTopic")
        : question.kind === "custom"
          ? t("mistakes.kindCustom")
          : t("mistakes.kindQuestion");
  return `${kindLabel} ${String(index + 1).padStart(2, "0")}`;
}

export default function MistakesPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const { authFetch } = useAuth();
  const { t, language } = useSiteLanguage();
  const { settings, patchSettings } = useTestPageSettings();
  const { seed: shuffleSeed, refreshSeed: refreshShuffleSeed } = useShuffleSeed("mistakes");
  const handleSettingsChange = useCallback(
    (next: typeof settings) => {
      if (next.shuffleQuestions && !settings.shuffleQuestions) refreshShuffleSeed();
      patchSettings(next);
    },
    [patchSettings, refreshShuffleSeed, settings.shuffleQuestions]
  );

  const [tab, setTab] = useState<TabKey>("list");
  const [idx, setIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [finishOpen, setFinishOpen] = useState(false);
  const autoNextTimerRef = useRef<number | null>(null);
  const questionCardRef = useRef<HTMLDivElement | null>(null);
  const [imageLoading, setImageLoading] = useState(true);
  const shuffleSettingRef = useRef(settings.shuffleQuestions);

  const mistakesQuery = useQuery({
    queryKey: ["mistakes", language],
    queryFn: async () => {
      const res = await authFetch("/api/mistakes");
      const data = await jsonOrError(res);
      return Array.isArray(data.questions) ? (data.questions as MistakeQuestion[]) : [];
    }
  });

  useEffect(() => {
    if (mistakesQuery.error) toast.error((mistakesQuery.error as any)?.message || t("common.error"));
  }, [mistakesQuery.error, t]);

  const questions = mistakesQuery.data || [];
  const currentQuestions = useMemo(
    () => (settings.shuffleQuestions ? shuffleQuestionsWithSeed(questions, shuffleSeed) : questions),
    [questions, settings.shuffleQuestions, shuffleSeed]
  );
  const currentQuestion = useMemo(() => currentQuestions[idx] ?? null, [currentQuestions, idx]);

  useEffect(() => {
    if (idx >= currentQuestions.length) setIdx(Math.max(0, currentQuestions.length - 1));
  }, [currentQuestions.length, idx]);

  useEffect(() => {
    if (shuffleSettingRef.current === settings.shuffleQuestions) return;
    shuffleSettingRef.current = settings.shuffleQuestions;
    setIdx(0);
  }, [settings.shuffleQuestions]);

  useEffect(() => {
    if (settings.autoNext) return;
    if (autoNextTimerRef.current) {
      window.clearTimeout(autoNextTimerRef.current);
      autoNextTimerRef.current = null;
    }
  }, [settings.autoNext]);

  useEffect(() => {
    setImageLoading(Boolean(currentQuestion?.image));
  }, [currentQuestion?.id, currentQuestion?.image]);

  useEffect(() => {
    return () => {
      if (autoNextTimerRef.current) window.clearTimeout(autoNextTimerRef.current);
    };
  }, []);

  const syncMutation = useMutation({
    mutationFn: (nextAnswers: Record<string, number>) =>
      authFetch("/api/mistakes/progress", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers: nextAnswers })
      }).then(jsonOrError),
    onError: (error: any) => toast.error(error?.message || t("common.error")),
    onSuccess: async (data: any) => {
      await qc.invalidateQueries({ queryKey: ["mistakes"] });
      if (settings.shuffleQuestions) refreshShuffleSeed();
      setAnswers({});
      setIdx(0);
      setFinishOpen(false);
      toast.success(`${data?.fixed || 0} ${t("progress.correct", { count: "" }).replace("{count}", "").trim()}`);
    }
  });

  const removeMistakeMutation = useMutation({
    mutationFn: async (questionKey: string) => {
      const res = await authFetch(`/api/mistakes/${encodeURIComponent(questionKey)}`, {
        method: "DELETE"
      });
      return jsonOrError(res);
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["mistakes"] });
      toast.success(t("mistakes.clear"));
    },
    onError: (error: any) => toast.error(error?.message || t("common.error"))
  });

  function scheduleAutoNext(nextIndex: number) {
    if (autoNextTimerRef.current) window.clearTimeout(autoNextTimerRef.current);
    autoNextTimerRef.current = window.setTimeout(() => {
      setIdx((cur) => {
        if (cur !== nextIndex - 1) return cur;
        return nextIndex;
      });
    }, 900);
  }

  function answerCurrent(nextAnswer: number) {
    if (!currentQuestion) return;
    const nextAnswers = { ...answers, [currentQuestion.id]: nextAnswer };
    setAnswers(nextAnswers);
    if (settings.autoNext && idx < currentQuestions.length - 1) scheduleAutoNext(idx + 1);
  }

  const currentAnswered = Boolean(currentQuestion && answers[currentQuestion.id] !== undefined);
  useTestInteractions({
    enabled: tab === "practice" && Boolean(currentQuestion) && !currentAnswered && !finishOpen,
    currentIndex: idx,
    optionCount: currentQuestion?.options.length || 0,
    mode: "alpha",
    onSelect: (optionIndex) => answerCurrent(optionIndex),
    scrollTargetRef: questionCardRef
  });

  const answered = Object.keys(answers).length;
  const correctPlanned = currentQuestions.filter((question) => answers[question.id] !== undefined && Number(answers[question.id]) === question.correctIndex).length;
  const wrongPlanned = Math.max(answered - correctPlanned, 0);
  const percent = currentQuestions.length > 0 ? Math.round((answered / currentQuestions.length) * 100) : 0;
  const fixPercent = currentQuestions.length > 0 ? Math.round((correctPlanned / currentQuestions.length) * 100) : 0;

  if (mistakesQuery.isLoading) {
    return (
      <section className="view">
        <div className="muted">{t("common.loading")}</div>
      </section>
    );
  }

  return (
    <section className="view mistakesView">
      <div className="topicHeader mistakesHeader">
        <div className="topicHeaderLeft">
          <button className="btn btn-ghost btn-sm" type="button" onClick={() => router.push("/app")}>
            <ArrowLeft className="lucide" aria-hidden="true" /> {t("common.back")}
          </button>
          <div>
            <div className="h2" style={{ margin: 0 }}>
              {t("mistakes.title")}
            </div>
            <div className="muted">{t("mistakes.subtitle")}</div>
          </div>
        </div>

        <div className="mistakesHeaderMeta">
          <TestPageSettingsButton settings={settings} onChange={handleSettingsChange} />
          <span className="badge">{questions.length}</span>
          <span className="badge">{currentQuestions.length}</span>
        </div>
      </div>

      <div className="mistakesTabs">
        <button className={`mistakesTab ${tab === "list" ? "active" : ""}`} type="button" onClick={() => setTab("list")}>
          <List className="lucide" aria-hidden="true" />
          <span>{t("mistakes.listTab")}</span>
          <span className="badge">{questions.length}</span>
        </button>
        <button
          className={`mistakesTab mistakesTabPractice ${tab === "practice" ? "active" : ""}`}
          type="button"
          onClick={() => setTab("practice")}
        >
          <Target className="lucide" aria-hidden="true" />
          <span>{t("mistakes.practiceTab")}</span>
          <span className="badge">{questions.length}</span>
        </button>
      </div>

      {tab === "list" ? (
        <>
          {!questions.length ? (
            <div className="card" style={{ padding: 16 }}>
              <div className="h2" style={{ margin: 0 }}>
                {t("mistakes.empty")}
              </div>
              <div className="muted" style={{ marginTop: 8 }}>
                {t("mistakes.subtitle")}
              </div>
            </div>
          ) : (
            <div className="answersQuestionGrid mistakesQuestionGrid">
              {questions.map((question, index) => (
                <article className="card answersQuestionCard mistakesQuestionCard" key={question.id || `${question.sourceId}-${index}`}>
                  <div className="answersQuestionCardHead mistakesQuestionCardHead">
                    <div className="answersQuestionCardTitle">{mistakeLabel(question, index, t)}</div>
                    <span className="badge">{question.hasImage ? t("answers.withImage") : t("answers.withoutImage")}</span>
                    <button
                      className="mistakesDeleteBtn"
                      type="button"
                      aria-label={t("mistakes.clear")}
                      onClick={() => removeMistakeMutation.mutate(question.id)}
                    >
                      <Trash2 className="lucide" aria-hidden="true" />
                    </button>
                  </div>

                  <div className="mistakesSource">{question.sourceTitle}</div>
                  <div className="answersQuestionTextBig">{question.text}</div>

                  {question.image ? (
                    <div className="answersQuestionImageWrap">
                      <img className="answersQuestionImage" src={resolveQuestionImage(question.image)} alt={question.text} />
                    </div>
                  ) : null}

                  <div className="mistakesAnswerRow">
                    <div className="mistakesAnswerBox bad">
                      <div className="mistakesAnswerLabel">{t("mistakes.wrongAnswer")}</div>
                      <div className="mistakesAnswerValue">
                        {question.wrongAnswer === null ? "—" : question.options[question.wrongAnswer] || t("common.noData")}
                      </div>
                    </div>
                    <div className="mistakesAnswerBox good">
                      <div className="mistakesAnswerLabel">{t("mistakes.correctAnswer")}</div>
                      <div className="mistakesAnswerValue">{question.correctAnswer || "—"}</div>
                    </div>
                  </div>

                  {question.explanation ? <div className="answersExplanation">{question.explanation}</div> : null}
                  {question.audio ? <QuestionAudio audio={question.audio} /> : null}

                  <div className="mistakesCardActions">
                    <button
                      className="btn btn-primary"
                      type="button"
                      onClick={() => {
                        const nextIndex = questions.findIndex((item) => item.id === question.id);
                        setTab("practice");
                        setIdx(nextIndex >= 0 ? nextIndex : 0);
                      }}
                    >
                      {t("mistakes.practiceTab")}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          {!currentQuestions.length ? (
            <div className="card" style={{ padding: 16 }}>
              <div className="h2" style={{ margin: 0 }}>
                {t("mistakes.empty")}
              </div>
              <div className="muted" style={{ marginTop: 8 }}>
                {t("mistakes.subtitle")}
              </div>
            </div>
          ) : (
            <>
              {currentQuestion ? (
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
                              onClick={() => answerCurrent(optionIndex)}
                            >
                              <span className="optionKey">{optionLetter(optionIndex)}</span>
                              <span className="optionText">{option}</span>
                            </button>
                          );
                        })}
                      </div>

                      {answers[currentQuestion.id] !== undefined && currentQuestion.explanation ? (
                        <div className="explanation">
                          <div className="explanationLabel">{t("public.explanation")}</div>
                          <MarkdownText text={currentQuestion.explanation} />
                        </div>
                      ) : null}
                      {answers[currentQuestion.id] !== undefined && currentQuestion.audio ? (
                        <QuestionAudio audio={currentQuestion.audio} />
                      ) : null}
                    </div>

                    <div className="qLeft">
                      {imageLoading && (
                        <div className="qImageLoader" aria-label="Rasm yuklanmoqda">
                          <span className="qSpinner" />
                        </div>
                      )}
                      <img
                        className={`qimg ${imageLoading ? "isLoading" : ""}`}
                        src={resolveQuestionImage(currentQuestion.image)}
                        alt={t("public.explanation")}
                        onLoad={() => setImageLoading(false)}
                        onError={(event) => {
                          const img = event.currentTarget;
                          setImageLoading(false);
                          if (img.src !== FALLBACK_IMAGE) img.src = FALLBACK_IMAGE;
                        }}
                      />
                    </div>
                  </div>
                </div>
              ) : null}

              <div className="qnav">
                {currentQuestions.map((question, questionIndex) => (
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

              <div className="topicFooter">
                <div className="footerLeft">
                  <button className="btn btn-ghost" type="button" onClick={() => setIdx(Math.max(0, idx - 1))} disabled={idx <= 0}>
                    <ChevronLeft className="lucide" aria-hidden="true" /> {t("common.back")}
                  </button>
                  <button
                    className="btn btn-ghost"
                    type="button"
                    onClick={() => setIdx(Math.min(currentQuestions.length - 1, idx + 1))}
                    disabled={idx >= currentQuestions.length - 1}
                  >
                    {t("common.next")} <ChevronRight className="lucide" aria-hidden="true" />
                  </button>
                </div>
                <div className="footerRight">
                  <button className="btn btn-danger" type="button" onClick={() => setAnswers({})}>
                    <RotateCcw className="lucide" aria-hidden="true" /> {t("mistakes.clear")}
                  </button>
                  <button className="btn btn-primary" type="button" onClick={() => setFinishOpen(true)}>
                    <Flag className="lucide" aria-hidden="true" /> {t("topicDetail.finish")}
                  </button>
                </div>
              </div>
            </>
          )}
        </>
      )}

      {finishOpen ? (
        <>
          <div className="modalOverlay" onClick={() => setFinishOpen(false)} />
          <div className="modal modalResult" role="dialog" aria-modal="true">
            <div className="modalHeader">
            <div className="modalTitle">{t("topicDetail.finishTitle")}</div>
              <button className="btn btn-ghost" type="button" onClick={() => setFinishOpen(false)}>
                ✕
              </button>
            </div>
            <div className="modalBody">
              <div className="resultBlock resultChartBlock">
                <div className="resultChart">
                  <div
                    className="resultChartRing"
                    style={{
                      background: `conic-gradient(var(--ok) 0 ${fixPercent}%, var(--bad) ${fixPercent}% 100%)`
                    }}
                  >
                    <div className="resultChartCenter">
                      <div className="resultChartValue">{fixPercent}%</div>
                      <div className="resultChartLabel">{t("progress.title")}</div>
                    </div>
                  </div>
                  <div className="resultSolved">
                    <div className="muted">{t("answers.loaded", { count: answered })}</div>
                    <div className="resultSolvedValue">
                      {correctPlanned}/{currentQuestions.length}
                    </div>
                  </div>
                </div>
              </div>
              <button className="btn btn-primary resultCloseBtn" type="button" onClick={() => syncMutation.mutate(answers)} disabled={syncMutation.isPending}>
                {syncMutation.isPending ? t("common.loading") : t("common.save")}
              </button>
            </div>
          </div>
        </>
      ) : null}
    </section>
  );
}
