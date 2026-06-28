"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, RotateCcw } from "lucide-react";
import type { PublicQuestion } from "@/lib/server-api";
import { QuestionAudio } from "@/lib/question-audio";

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
  questions: PublicQuestion[];
  backHref: string;
  backLabel?: string;
}) {
  const [idx, setIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const autoNextTimerRef = useRef<number | null>(null);

  const total = questions.length;
  const q = questions[idx];
  const answered = Object.keys(answers).length;

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
  }

  useEffect(() => clearAutoNext, []);

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
          <Link className="btn btn-ghost btn-sm" href={backHref}>
            <ArrowLeft className="lucide" aria-hidden="true" /> {backLabel}
          </Link>
          <div>
            <div className="h2" style={{ margin: 0 }}>
              {title}
            </div>
            <div className="muted">{`Javoblar: ${answered}/${total}`}</div>
          </div>
        </div>

        <div className="topicHeaderActions">
          <button className="btn btn-danger btn-sm" type="button" onClick={reset}>
            <RotateCcw className="lucide" aria-hidden="true" /> Qayta boshlash
          </button>
        </div>
      </div>

      <div className="card">
        <div className="qTitleBar">{q.text}</div>
        <div className="qLayout">
          <div className="qRight">
            <div className="options">
              {q.options.map((opt, oi) => {
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
              })}
            </div>

            {answers[q.id] !== undefined && q.explanation ? (
              <div className="explanation">
                <div className="explanationLabel">Izoh</div>
                <div className="publicExplanationText">{q.explanation}</div>
              </div>
            ) : null}
            {answers[q.id] !== undefined && q.audio ? <QuestionAudio audio={q.audio} /> : null}
          </div>
          <div className="qLeft">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="qimg" src={resolveImg(q.image)} alt="Savol rasmi" />
          </div>
        </div>
      </div>

      <div className="qnav">
        {questions.map((qq, i) => {
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

      <div className="ticketNavRow">
        <button className="btn btn-ghost" type="button" onClick={() => goTo(Math.max(0, idx - 1))} disabled={idx <= 0}>
          <ArrowLeft className="lucide" aria-hidden="true" /> Orqaga
        </button>
        <button
          className="btn btn-ghost"
          type="button"
          onClick={() => goTo(Math.min(total - 1, idx + 1))}
          disabled={idx >= total - 1}
        >
          Keyingi
        </button>
      </div>
    </section>
  );
}
