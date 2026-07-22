"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ChevronLeft, ChevronRight, Flag, RotateCcw } from "lucide-react";
import { Cell, Pie, PieChart } from "recharts";
import type { PublicQuestion } from "@/lib/server-api";
import { QuestionAudio } from "@/lib/question-audio";
import { useSiteLanguage } from "@/app/site-language-provider";

const FALLBACK_IMAGE = "/default.png";

function resolveImg(image?: string) {
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

export default function PublicTestRunner({
  title,
  questions,
  backHref,
  backLabel = "Orqaga"
}: {
  title: string;
  questions: Array<PublicQuestion | null>;
  backHref: string;
  backLabel?: string;
}) {
  const { t } = useSiteLanguage();
  const [idx, setIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [finishOpen, setFinishOpen] = useState(false);
  const autoNextTimerRef = useRef<number | null>(null);

  const total = questions.length;
  const answeredQuestions = questions.filter(Boolean);
  const q = questions[idx];
  const answered = Object.keys(answers).length;
  const correctCount = answeredQuestions.filter(
    (question) => question && answers[question.id] !== undefined && Number(answers[question.id]) === Number(question.correctIndex)
  ).length;
  const scoredTotal = answeredQuestions.length || total;
  const correctPercent = scoredTotal > 0 ? Math.round((correctCount / scoredTotal) * 100) : 0;
  const chartData = [
    { name: "To‘g‘ri", value: correctCount },
    { name: "Noto‘g‘ri", value: Math.max(scoredTotal - correctCount, 0) }
  ];

  function clearAutoNext() {
    if (autoNextTimerRef.current) {
      window.clearTimeout(autoNextTimerRef.current);
      autoNextTimerRef.current = null;
    }
  }

  function goTo(nextIndex: number) {
    clearAutoNext();
    setIdx(nextIndex);
  }

  function selectOption(optionIndex: number) {
    if (!q || answers[q.id] !== undefined) return;
    setAnswers((prev) => ({ ...prev, [q.id]: optionIndex }));
    if (idx < total - 1) {
      clearAutoNext();
      autoNextTimerRef.current = window.setTimeout(() => {
        setIdx((cur) => (cur === idx ? cur + 1 : cur));
      }, 900);
    }
  }

  function reset() {
    clearAutoNext();
    setAnswers({});
    setIdx(0);
    setFinishOpen(false);
  }

  useEffect(() => clearAutoNext, []);

  return (
    <section className="view">
      <div className="ticketHeader">
        <div className="ticketHeaderLeft">
          <Link className="btn btn-ghost btn-sm" href={backHref}>
            <ArrowLeft className="lucide" aria-hidden="true" /> {backLabel}
          </Link>
          <div>
            <h1 className="h2" style={{ margin: 0 }}>
              {title}
            </h1>
            <div className="muted">{t("publicRunner.unanswered", { answered, total })}</div>
          </div>
        </div>

        <div className="topicHeaderActions">
          <button className="btn btn-danger btn-sm" type="button" onClick={reset}>
            <RotateCcw className="lucide" aria-hidden="true" /> {t("publicRunner.restart")}
          </button>
        </div>
      </div>

      <div className="card">
        <div className="qTitleBar">{q?.text || t("publicRunner.emptySlot")}</div>
        <div className="qLayout">
          <div className="qRight">
            <div className="options">
              {q?.options.length ? (
                q.options.map((opt, oi) => {
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
                      onClick={() => selectOption(oi)}
                    >
                      <span className="optionKey">F{oi + 1}</span>
                      <span className="optionText">{opt}</span>
                    </button>
                  );
                })
              ) : (
                <div className="emptyQuestionState">{t("publicRunner.emptyQuestion")}</div>
              )}
            </div>

            {q && answers[q.id] !== undefined && q.explanation ? (
              <div className="explanation">
                <div className="explanationLabel">{t("public.explanation")}</div>
                <div className="publicExplanationText">{q.explanation}</div>
              </div>
            ) : null}
            {q && answers[q.id] !== undefined && q.audio ? <QuestionAudio audio={q.audio} /> : null}
          </div>
          <div className="qLeft">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="qimg" src={resolveImg(q?.image)} alt="Savol rasmi" />
          </div>
        </div>
      </div>

      <div className="qnav">
        {questions.map((qq, i) => {
          if (!qq) {
            return (
              <button key={i} className={`qbtn ${i === idx ? "active" : ""} qbtnEmpty`} type="button" onClick={() => goTo(i)}>
                {i + 1}
              </button>
            );
          }
          const selected = answers[qq.id];
          const hasAnswered = selected !== undefined;
          const isWrong = hasAnswered && Number(selected) !== Number(qq.correctIndex);
          const isCorrect = hasAnswered && Number(selected) === Number(qq.correctIndex);
          return (
            <button
              key={qq.id || i}
              className={`qbtn ${i === idx ? "active" : ""} ${isCorrect ? "answered correct" : ""} ${
                isWrong ? "answered wrong" : ""
              }`}
              type="button"
              onClick={() => goTo(i)}
            >
              {i + 1}
            </button>
          );
        })}
      </div>

      <div className="ticketFooter">
        <div className="footerLeft">
          <button className="btn btn-ghost" type="button" onClick={() => goTo(Math.max(0, idx - 1))} disabled={idx <= 0}>
            <ChevronLeft className="lucide" aria-hidden="true" /> {t("common.back")}
          </button>
          <button
            className="btn btn-ghost"
            type="button"
            onClick={() => goTo(Math.min(total - 1, idx + 1))}
            disabled={idx >= total - 1}
          >
            {t("common.next")} <ChevronRight className="lucide" aria-hidden="true" />
          </button>
        </div>
        <div className="footerRight">
          <button className="btn btn-primary" type="button" onClick={() => setFinishOpen(true)}>
            <Flag className="lucide" aria-hidden="true" /> {t("publicRunner.finish")}
          </button>
        </div>
      </div>

      {finishOpen && (
        <>
          <div className="modalOverlay" onClick={() => setFinishOpen(false)} />
          <div className="modal modalResult" role="dialog" aria-modal="true">
            <div className="modalHeader">
              <div className="modalTitle">{t("publicRunner.resultTitle")}</div>
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
                    <div className="muted">{t("publicRunner.correctAnswers")}</div>
                    <div className="chartCount">
                      {correctCount}/{total}
                    </div>
                  </div>
                </div>
              </div>
              <div className="payRow" style={{ marginTop: 4 }}>
                <button className="btn btn-ghost payBtn" type="button" onClick={reset}>
                  <RotateCcw className="lucide" aria-hidden="true" /> {t("publicRunner.restart")}
                </button>
                <button className="btn btn-primary payBtn" type="button" onClick={() => setFinishOpen(false)}>
                  {t("publicRunner.finishButton")}
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
