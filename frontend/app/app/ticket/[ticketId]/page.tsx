"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useParams, useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { ArrowLeft, ChevronLeft, ChevronRight, Flag, RotateCcw } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Cell, Pie, PieChart } from "recharts";
import { useAuth } from "@/app/auth-provider";
import { jsonOrError } from "@/lib/api-authed";
import { QuestionAudio } from "@/lib/question-audio";
import { TestPageSettingsButton, shuffleQuestionsWithSeed, useShuffleSeed, useTestPageSettings } from "@/lib/test-page-settings";
import { useTestInteractions } from "@/lib/test-interactions";

type Question = {
  id: string;
  text: string;
  image?: string;
  audio?: string;
  options: string[];
  correctIndex: number;
  explanation?: string;
};

type Ticket = { id: string; title: string; questions: Question[] };

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
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }

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

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

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

    if (/^(\d+\.\s+|[-*+]\s+)/.test(trimmed)) {
      const ordered = /^\d+\.\s+/.test(trimmed);
      const items: string[] = [];
      while (index < lines.length) {
        const current = lines[index].trim();
        if (ordered ? !/^\d+\.\s+/.test(current) : !/^[-*+]\s+/.test(current)) break;
        items.push(current.replace(/^\d+\.\s+|^[-*+]\s+/, ""));
        index += 1;
      }
      const ListTag = ordered ? "ol" : "ul";
      blocks.push(
        <ListTag key={`md-block-${blocks.length}`} className="markdownList">
          {items.map((item, itemIndex) => (
            <li key={itemIndex} className="markdownListItem">
              {renderInlineMarkdown(item, `md-li-${blocks.length}-${itemIndex}`)}
            </li>
          ))}
        </ListTag>
      );
      continue;
    }

    const paragraphLines: string[] = [line];
    index += 1;
    while (index < lines.length) {
      const next = lines[index];
      const nextTrimmed = next.trim();
      if (
        !nextTrimmed ||
        nextTrimmed.startsWith("```") ||
        /^#{1,6}\s+/.test(nextTrimmed) ||
        /^>\s?/.test(nextTrimmed) ||
        /^(\d+\.\s+|[-*+]\s+)/.test(nextTrimmed)
      ) {
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

export default function TicketPage() {
  const router = useRouter();
  const params = useParams<{ ticketId: string }>();
  const ticketId = String(params.ticketId || "");
  const qc = useQueryClient();
  const { authFetch } = useAuth();
  const { settings, patchSettings } = useTestPageSettings();
  const { seed: shuffleSeed, refreshSeed: refreshShuffleSeed } = useShuffleSeed(`ticket:${ticketId}`);
  const handleSettingsChange = useCallback(
    (next: typeof settings) => {
      if (next.shuffleQuestions && !settings.shuffleQuestions) refreshShuffleSeed();
      patchSettings(next);
    },
    [patchSettings, refreshShuffleSeed, settings.shuffleQuestions]
  );

  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [idx, setIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const autoNextTimerRef = useRef<number | null>(null);
  const questionCardRef = useRef<HTMLDivElement | null>(null);
  const [finishOpen, setFinishOpen] = useState(false);
  const [imageLoading, setImageLoading] = useState(true);
  const [zoomedImage, setZoomedImage] = useState<string | null>(null);
  const shuffleSettingRef = useRef(settings.shuffleQuestions);

  const ticketQuestions = useMemo(
    () =>
      ticket && Array.isArray(ticket.questions)
        ? settings.shuffleQuestions
          ? shuffleQuestionsWithSeed(ticket.questions, shuffleSeed)
          : ticket.questions
        : [],
    [settings.shuffleQuestions, shuffleSeed, ticket]
  );
  const q = useMemo(() => ticketQuestions[idx] ?? null, [ticketQuestions, idx]);

  const ticketQuery = useQuery({
    queryKey: ["ticket", ticketId],
    queryFn: async () => {
      const res = await authFetch(`/api/tickets/${encodeURIComponent(ticketId)}`);
      const data = await jsonOrError(res);
      setTicket(data.ticket);
      return data;
    }
  });

  const progressQuery = useQuery({
    queryKey: ["progress", ticketId],
    queryFn: async () => {
      const res = await authFetch(`/api/progress/${encodeURIComponent(ticketId)}`);
      const data = await jsonOrError(res);
      if (data?.progress?.answers) setAnswers(data.progress.answers);
      return data;
    }
  });

  useEffect(() => {
    if (ticketQuery.error) toast.error((ticketQuery.error as any)?.message || "Xatolik");
  }, [ticketQuery.error]);

  useEffect(() => {
    // progress error is not critical
  }, [progressQuery.error]);

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
    setImageLoading(Boolean(q?.image));
  }, [q?.id, q?.image]);

  useEffect(() => {
    if (!zoomedImage) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setZoomedImage(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [zoomedImage]);

  const saveMutation = useMutation({
    mutationFn: (nextAnswers: Record<string, number>) =>
      authFetch(`/api/progress/${encodeURIComponent(ticketId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers: nextAnswers })
      }).then(jsonOrError),
    onError: (e: any) => toast.error(e?.message || "Xatolik"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["progress", ticketId] })
  });

  function save(nextAnswers: Record<string, number>) {
    setAnswers(nextAnswers);
    saveMutation.mutate(nextAnswers);
  }

  function scheduleAutoNext(nextIndex: number) {
    if (autoNextTimerRef.current) window.clearTimeout(autoNextTimerRef.current);
    autoNextTimerRef.current = window.setTimeout(() => {
      setIdx((cur) => {
        // Only move forward if user didn't manually change question
        if (cur !== nextIndex - 1) return cur;
        return nextIndex;
      });
    }, 900);
  }

  useEffect(() => {
    return () => {
      if (autoNextTimerRef.current) window.clearTimeout(autoNextTimerRef.current);
    };
  }, []);

  const total = ticketQuestions.length;
  const answered = Object.keys(answers).length;
  const correctCount = ticketQuestions.filter(
    (question) => answers[question.id] !== undefined && Number(answers[question.id]) === Number(question.correctIndex)
  ).length || 0;
  const correctPercent = total > 0 ? Math.round((correctCount / total) * 100) : 0;
  const chartData = [
    { name: "To‘g‘ri", value: correctCount },
    { name: "Noto‘g‘ri", value: Math.max(total - correctCount, 0) }
  ];

  const resetMutation = useMutation({
    mutationFn: () => authFetch(`/api/progress/${encodeURIComponent(ticketId)}/reset`, { method: "POST" }).then(jsonOrError),
    onSettled: () => {
      setAnswers({});
      setIdx(0);
      qc.invalidateQueries({ queryKey: ["progress", ticketId] });
    }
  });

  function reset() {
    if (settings.shuffleQuestions) refreshShuffleSeed();
    resetMutation.mutate();
  }

  const currentAnswered = Boolean(q && answers[q.id] !== undefined);
  useTestInteractions({
    enabled: Boolean(q) && !currentAnswered && !zoomedImage && !finishOpen,
    currentIndex: idx,
    optionCount: q?.options.length || 0,
    mode: "function",
    onSelect: (optionIndex) => {
      if (!q) return;
      const nextAnswers = { ...answers, [q.id]: optionIndex };
      save(nextAnswers);
      if (settings.autoNext && idx < total - 1) scheduleAutoNext(idx + 1);
    },
    scrollTargetRef: questionCardRef
  });

  if (!ticket) {
    return (
      <section className="view">
        <div className="muted">Yuklanmoqda...</div>
      </section>
    );
  }

  if (!q) {
    return (
      <section className="view">
        <div className="muted">Savol topilmadi.</div>
      </section>
    );
  }

  return (
    <section className="view">
      <div className="ticketHeader">
        <div className="ticketHeaderLeft">
          <button className="btn btn-ghost btn-sm" type="button" onClick={() => router.push("/app/tickets")}>
            <ArrowLeft className="lucide" aria-hidden="true" /> Orqaga
          </button>
          <div>
            <div className="h2" style={{ margin: 0 }}>
              {ticket.title}
            </div>
            <div className="muted">{`Javoblar: ${answered}/${total}`}</div>
          </div>
        </div>

        <div className="topicHeaderActions">
          <TestPageSettingsButton settings={settings} onChange={handleSettingsChange} />
          <button className="btn btn-danger btn-sm" type="button" onClick={reset}>
            <RotateCcw className="lucide" aria-hidden="true" /> Qayta boshlash
          </button>
        </div>
      </div>

      <div className="card" ref={questionCardRef}>
        <div className="qTitleBar">{q?.text}</div>
        <div className="qLayout">
          <div className="qRight">
            <div className="options">
              {q?.options.map((opt, oi) => {
                const selected = answers[q.id];
                const hasAnswered = selected !== undefined;
                const correct = oi === q.correctIndex;
                const wrong = hasAnswered && oi === selected && !correct;
                return (
                  <button
                    key={oi}
                    className={`option ${hasAnswered && correct ? "correct" : ""} ${wrong ? "wrong" : ""}`}
                    type="button"
                    disabled={hasAnswered}
                    onClick={() => {
                      const nextAnswers = { ...answers, [q.id]: oi };
                      save(nextAnswers);
                      if (settings.autoNext && idx < total - 1) scheduleAutoNext(idx + 1);
                    }}
                  >
                    <span className="optionKey">F{oi + 1}</span>
                    <span className="optionText">{opt}</span>
                  </button>
                );
              })}
            </div>

            {answers[q.id] !== undefined && q.explanation ? (
              <div className="explanation">
                <div className="explanationLabel">Izoh</div>
                <MarkdownText text={q.explanation} />
              </div>
            ) : null}
            {answers[q.id] !== undefined && q.audio ? <QuestionAudio audio={q.audio} /> : null}
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
              onClick={() => setZoomedImage(resolveQuestionImage(q?.image))}
              aria-label="Rasmni kattalashtirish"
            >
              <img
                className={`qimg ${imageLoading ? "isLoading" : ""}`}
                src={resolveQuestionImage(q?.image)}
                alt="Savol rasmi"
                onLoad={() => setImageLoading(false)}
                onError={(e) => {
                  const img = e.currentTarget;
                  setImageLoading(false);
                  if (img.src !== FALLBACK_IMAGE) img.src = FALLBACK_IMAGE;
                }}
              />
            </button>
          </div>
        </div>
      </div>

      <div className="qnav">
        {ticket.questions.map((qq, i) => (
          (() => {
            const selected = answers[qq.id];
            const hasAnswered = selected !== undefined;
            const isWrong = hasAnswered && Number(selected) !== Number(qq.correctIndex);
            const isCorrect = hasAnswered && Number(selected) === Number(qq.correctIndex);
            return (
              <button
                key={qq.id}
                className={`qbtn ${i === idx ? "active" : ""} ${isCorrect ? "answered correct" : ""} ${isWrong ? "answered wrong" : ""} ${hasAnswered && !isWrong && !isCorrect ? "answered" : ""}`}
                type="button"
                onClick={() => setIdx(i)}
              >
                {i + 1}
              </button>
            );
          })()
        ))}
      </div>

      <div className="ticketFooter">
        <div className="footerLeft">
          <button className="btn btn-ghost" type="button" onClick={() => setIdx(Math.max(0, idx - 1))} disabled={idx <= 0}>
            <ChevronLeft className="lucide" aria-hidden="true" /> Orqaga
          </button>
          <button className="btn btn-ghost" type="button" onClick={() => setIdx(Math.min(total - 1, idx + 1))} disabled={idx >= total - 1}>
            Keyingi <ChevronRight className="lucide" aria-hidden="true" />
          </button>
        </div>
        <div className="footerRight">
          <button className="btn btn-primary" type="button" onClick={() => setFinishOpen(true)}>
            <Flag className="lucide" aria-hidden="true" /> Yakunlash
          </button>
        </div>
      </div>

      {finishOpen && (
        <>
          <div className="modalOverlay" onClick={() => setFinishOpen(false)} />
          <div className="modal modalResult" role="dialog" aria-modal="true">
            <div className="modalHeader">
              <div className="modalTitle">Natija</div>
              <button className="btn btn-ghost" type="button" onClick={() => setFinishOpen(false)}>
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
                      <div className="chartValue">{correctPercent}%</div>
                      <div className="chartLabel">To‘g‘ri</div>
                    </div>
                  </div>
                  <div className="chartMeta">
                    <div className="muted">To‘g‘ri javoblar</div>
                    <div className="chartCount">{correctCount}/{total}</div>
                  </div>
                </div>
              </div>
              <button className="btn btn-primary" type="button" onClick={() => setFinishOpen(false)}>
                Yopish
              </button>
            </div>
          </div>
        </>
      )}

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
