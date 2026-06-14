"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useParams, useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { ArrowLeft, ChevronLeft, ChevronRight, Flag, Mic, RotateCcw, Trash2, UploadCloud } from "lucide-react";
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

type Topic = { id: string; title: string; questions: Question[] };

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

type AudioDraft = {
  previewUrl: string;
  recording: boolean;
  uploading: boolean;
  blob: Blob | null;
  mimeType: string;
};

async function blobToDataUrl(blob: Blob) {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Audio o‘qib bo‘lmadi"));
    reader.readAsDataURL(blob);
  });
}

function getAudioFileExtension(mimeType: string) {
  const value = String(mimeType || "").toLowerCase();
  if (value.startsWith("audio/webm")) return "webm";
  if (value.startsWith("audio/ogg")) return "ogg";
  if (value.startsWith("audio/mp4")) return "m4a";
  if (value.startsWith("audio/mpeg")) return "mp3";
  if (value.startsWith("audio/wav")) return "wav";
  return "webm";
}

function pickAudioMimeType() {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus", "audio/ogg"];
  if (typeof MediaRecorder === "undefined") return "";
  return candidates.find((value) => MediaRecorder.isTypeSupported(value)) || "";
}

export default function TopicPage() {
  const router = useRouter();
  const params = useParams<{ topicId: string }>();
  const topicId = String(params.topicId || "");
  const qc = useQueryClient();
  const { authFetch, authReady, accessToken } = useAuth();
  const { settings, patchSettings } = useTestPageSettings();
  const { seed: shuffleSeed, refreshSeed: refreshShuffleSeed } = useShuffleSeed(`topic:${topicId}`);
  const handleSettingsChange = useCallback(
    (next: typeof settings) => {
      if (next.shuffleQuestions && !settings.shuffleQuestions) refreshShuffleSeed();
      patchSettings(next);
    },
    [patchSettings, refreshShuffleSeed, settings.shuffleQuestions]
  );

  const [topic, setTopic] = useState<Topic | null>(null);
  const [idx, setIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const autoNextTimerRef = useRef<number | null>(null);
  const questionCardRef = useRef<HTMLDivElement | null>(null);
  const [finishOpen, setFinishOpen] = useState(false);
  const [imageLoading, setImageLoading] = useState(true);
  const [zoomedImage, setZoomedImage] = useState<string | null>(null);
  const autoResetRef = useRef(false);
  const shuffleSettingRef = useRef(settings.shuffleQuestions);
  const [audioDrafts, setAudioDrafts] = useState<Record<string, AudioDraft>>({});
  const audioObjectUrlsRef = useRef<Record<string, string>>({});
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const mediaChunksRef = useRef<Blob[]>([]);
  const recordingQuestionIdRef = useRef<string | null>(null);
  const meQuery = useQuery({
    queryKey: ["topic-me"],
    queryFn: async () => {
      const res = await authFetch("/api/auth/me");
      return jsonOrError(res);
    },
    retry: false,
    enabled: authReady && Boolean(accessToken)
  });
  const isAdmin = Boolean(meQuery.data?.user?.is_admin);

  const topicQuestions = useMemo(
    () =>
      topic && Array.isArray(topic.questions)
        ? settings.shuffleQuestions
          ? shuffleQuestionsWithSeed(topic.questions, shuffleSeed)
          : topic.questions
        : [],
    [settings.shuffleQuestions, shuffleSeed, topic]
  );
  const q = useMemo(() => topicQuestions[idx] ?? null, [topicQuestions, idx]);

  const topicQuery = useQuery({
    queryKey: ["topic", topicId],
    queryFn: async () => {
      const res = await authFetch(`/api/topics/${encodeURIComponent(topicId)}`);
      const data = await jsonOrError(res);
      setTopic(data.topic);
      return data;
    }
  });

  const progressQuery = useQuery({
    queryKey: ["topic-progress", topicId],
    queryFn: async () => {
      const res = await authFetch(`/api/topic-progress/${encodeURIComponent(topicId)}`);
      return jsonOrError(res);
    }
  });

  useEffect(() => {
    if (topicQuery.error) toast.error((topicQuery.error as any)?.message || "Xatolik");
  }, [topicQuery.error]);

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

  useEffect(() => {
    return () => {
      Object.values(audioObjectUrlsRef.current).forEach((url) => URL.revokeObjectURL(url));
      audioObjectUrlsRef.current = {};
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
      mediaRecorderRef.current = null;
    };
  }, []);

  function cleanupAudioPreview(questionId: string) {
    const previousUrl = audioObjectUrlsRef.current[questionId];
    if (previousUrl) {
      URL.revokeObjectURL(previousUrl);
      delete audioObjectUrlsRef.current[questionId];
    }
  }

  async function stopQuestionRecording() {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === "inactive") return;
    recorder.stop();
  }

  async function startQuestionRecording(questionId: string) {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("Brauzer mikrofonni qo‘llab-quvvatlamaydi");
    }
    if (typeof MediaRecorder === "undefined") {
      throw new Error("Brauzer audio yozishni qo‘llab-quvvatlamaydi");
    }

    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      await stopQuestionRecording();
    }

    cleanupAudioPreview(questionId);
    setAudioDrafts((prev) => ({
      ...prev,
      [questionId]: {
        previewUrl: prev[questionId]?.previewUrl || "",
        recording: true,
        uploading: false,
        blob: null,
        mimeType: prev[questionId]?.mimeType || ""
      }
    }));

    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = pickAudioMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);

      mediaRecorderRef.current = recorder;
      mediaStreamRef.current = stream;
      mediaChunksRef.current = [];
      recordingQuestionIdRef.current = questionId;

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) mediaChunksRef.current.push(event.data);
      };

      recorder.onstop = () => {
        const activeQuestionId = recordingQuestionIdRef.current;
        const chunks = mediaChunksRef.current.slice();
        mediaChunksRef.current = [];
        recordingQuestionIdRef.current = null;
        mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
        mediaStreamRef.current = null;
        if (mediaRecorderRef.current === recorder) mediaRecorderRef.current = null;
        if (!activeQuestionId || !chunks.length) {
          setAudioDrafts((prev) => ({
            ...prev,
            [questionId]: {
              previewUrl: prev[questionId]?.previewUrl || "",
              recording: false,
              uploading: false,
              blob: prev[questionId]?.blob || null,
              mimeType: prev[questionId]?.mimeType || ""
            }
          }));
          return;
        }

        const blob = new Blob(chunks, { type: recorder.mimeType || mimeType || "audio/webm" });
        const previewUrl = URL.createObjectURL(blob);
        audioObjectUrlsRef.current[activeQuestionId] = previewUrl;
        setAudioDrafts((prev) => ({
          ...prev,
          [activeQuestionId]: {
            previewUrl,
            recording: false,
            uploading: false,
            blob,
            mimeType: blob.type || mimeType || "audio/webm"
          }
        }));
        persistQuestionAudio(activeQuestionId, blob, previewUrl).catch((error: any) => {
          toast.error(error?.message || "Audio avtomatik yuklanmadi");
        });
      };

      recorder.onerror = () => {
        setAudioDrafts((prev) => ({
          ...prev,
          [questionId]: {
            previewUrl: prev[questionId]?.previewUrl || "",
            recording: false,
            uploading: false,
            blob: prev[questionId]?.blob || null,
            mimeType: prev[questionId]?.mimeType || ""
          }
        }));
      };

      recorder.start();
      toast.success("Yozishni boshladingiz");
    } catch (error) {
      stream?.getTracks().forEach((track) => track.stop());
      setAudioDrafts((prev) => ({
        ...prev,
        [questionId]: {
          previewUrl: prev[questionId]?.previewUrl || "",
          recording: false,
          uploading: false,
          blob: prev[questionId]?.blob || null,
          mimeType: prev[questionId]?.mimeType || ""
        }
      }));
      throw error;
    }
  }

  async function persistQuestionAudio(questionId: string, blob: Blob, previewUrlOverride?: string) {
    if (!topic) throw new Error("Mavzu topilmadi");
    if (!blob) throw new Error("Avval audio yozib oling");

    const currentAudio = topic.questions.find((question) => question.id === questionId)?.audio || "";
    const audioType = blob.type || "audio/webm";
    const previewUrl = previewUrlOverride || audioDrafts[questionId]?.previewUrl || "";

    setAudioDrafts((prev) => ({
      ...prev,
      [questionId]: {
        previewUrl,
        recording: false,
        uploading: true,
        blob,
        mimeType: audioType
      }
    }));

    const audioBase64 = await blobToDataUrl(blob);
    const audioName = `question-${questionId}.${getAudioFileExtension(audioType)}`;

    const res = await authFetch("/api/upload-audio", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        audioBase64,
        audioName,
        audioType,
        topicId,
        questionId,
        oldAudioUrl: currentAudio
      })
    });
    const data = await jsonOrError(res);
    const audioUrl = String(data?.audioUrl || "").trim();
    if (!audioUrl) throw new Error("Audio yuklanmadi");

    cleanupAudioPreview(questionId);
    setTopic((prev) =>
      prev
        ? {
            ...prev,
            questions: prev.questions.map((question) => (question.id === questionId ? { ...question, audio: audioUrl } : question))
          }
        : prev
    );

    setAudioDrafts((prev) => ({
      ...prev,
      [questionId]: {
        previewUrl: audioUrl,
        recording: false,
        uploading: false,
        blob: null,
        mimeType: audioType
      }
    }));

    toast.success("Audio yuklandi");
  }

  async function uploadQuestionAudio(questionId: string) {
    const draft = audioDrafts[questionId];
    if (!draft?.blob) throw new Error("Avval audio yozib oling");
    return await persistQuestionAudio(questionId, draft.blob, draft.previewUrl || undefined);
  }

  async function uploadQuestionAudioFile(questionId: string, file: File) {
    if (!topic) throw new Error("Mavzu topilmadi");
    if (!file) throw new Error("Audio fayl tanlanmadi");

    const audioType = file.type || "audio/webm";
    cleanupAudioPreview(questionId);
    const previewUrl = URL.createObjectURL(file);
    audioObjectUrlsRef.current[questionId] = previewUrl;
    setAudioDrafts((prev) => ({
      ...prev,
      [questionId]: {
        previewUrl,
        recording: false,
        uploading: true,
        blob: file,
        mimeType: audioType
      }
    }));

    try {
      await persistQuestionAudio(questionId, file, previewUrl);
    } catch (error) {
      const message = (error as any)?.message || "Audio yuklanmadi";
      setAudioDrafts((prev) => ({
        ...prev,
        [questionId]: {
          previewUrl,
          recording: false,
          uploading: false,
          blob: file,
          mimeType: audioType
        }
      }));
      throw new Error(message);
    }
  }

  async function deleteQuestionAudio(questionId: string) {
    const currentAudio = topic?.questions.find((question) => question.id === questionId)?.audio || "";
    const draft = audioDrafts[questionId];

    if (draft?.previewUrl?.startsWith("blob:")) {
      cleanupAudioPreview(questionId);
    }

    if (!currentAudio) {
      setAudioDrafts((prev) => {
        const next = { ...prev };
        delete next[questionId];
        return next;
      });
      setTopic((prev) =>
        prev
          ? {
              ...prev,
              questions: prev.questions.map((question) => (question.id === questionId ? { ...question, audio: "" } : question))
            }
          : prev
      );
      toast.success("Audio o‘chirildi");
      return;
    }

    const res = await authFetch("/api/upload-audio", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        topicId,
        questionId,
        audioUrl: currentAudio
      })
    });
    const data = await jsonOrError(res);
    const audioUrl = String(data?.audioUrl || "").trim();

    setTopic((prev) =>
      prev
        ? {
            ...prev,
            questions: prev.questions.map((question) => (question.id === questionId ? { ...question, audio: audioUrl } : question))
          }
        : prev
    );

    setAudioDrafts((prev) => {
      const next = { ...prev };
      delete next[questionId];
      return next;
    });

    toast.success("Audio o‘chirildi");
  }

  const saveMutation = useMutation({
    mutationFn: (nextAnswers: Record<string, number>) =>
      authFetch(`/api/topic-progress/${encodeURIComponent(topicId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers: nextAnswers })
      }).then(jsonOrError),
    onError: (e: any) => toast.error(e?.message || "Xatolik"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["topic-progress", topicId] })
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

  const total = topicQuestions.length;
  const answered = Object.keys(answers).length;
  const correct = topicQuestions.reduce((sum, question) => {
    const selected = answers[question.id];
    return sum + (selected !== undefined && Number(selected) === Number(question.correctIndex) ? 1 : 0);
  }, 0);
  const wrong = Math.max(answered - correct, 0);
  const correctPercent = total > 0 ? Math.round((correct / total) * 100) : 0;
  const chartData = [
    { name: "To‘g‘ri", value: correct },
    { name: "Noto‘g‘ri", value: Math.max(total - correct, 0) }
  ];

  const resetMutation = useMutation({
    mutationFn: () => authFetch(`/api/topic-progress/${encodeURIComponent(topicId)}/reset`, { method: "POST" }).then(jsonOrError),
    onSettled: () => {
      setAnswers({});
      setIdx(0);
      qc.invalidateQueries({ queryKey: ["topic-progress", topicId] });
    }
  });

  function reset() {
    if (settings.shuffleQuestions) refreshShuffleSeed();
    resetMutation.mutate();
  }

  useEffect(() => {
    if (!topic || autoResetRef.current) return;
    autoResetRef.current = true;
    setAnswers({});
    setIdx(0);
    setFinishOpen(false);
    if (settings.shuffleQuestions) refreshShuffleSeed();
    resetMutation.mutate();
  }, [refreshShuffleSeed, settings.shuffleQuestions, topic, resetMutation]);

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

  if (!topic) {
    return (
      <section className="view">
        <div className="muted">Yuklanmoqda...</div>
      </section>
    );
  }

  if (!q) {
    return (
      <section className="view">
        <div className="card" style={{ padding: 18 }}>
          <div className="h2" style={{ margin: 0 }}>
            {topic.title}
          </div>
          <div className="muted" style={{ marginTop: 8 }}>
            Bu mavzuda hali test yo‘q.
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="view">
      <div className="topicHeader">
        <div className="topicHeaderLeft">
          <button className="btn btn-ghost btn-sm" type="button" onClick={() => router.push("/app/page/topics")}>
            <ArrowLeft className="lucide" aria-hidden="true" /> Orqaga
          </button>
          <div>
            <div className="h2" style={{ margin: 0 }}>
              {topic.title}
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

            {isAdmin ? (
              <div className="adminAudioBlock topicAdminAudioBlock">
                <div className="adminAudioHint">Admin uchun audio boshqaruvi</div>
                <div className="adminAudioButtons">
                  <button
                    className={`btn btn-sm adminAudioActionCard adminAudioMicBtn ${audioDrafts[q.id]?.recording ? "isRecording" : ""}`}
                    type="button"
                    title={audioDrafts[q.id]?.recording ? "Yozishni to‘xtatish" : "Mikrofon orqali yozish"}
                    aria-label={audioDrafts[q.id]?.recording ? "Yozishni to‘xtatish" : "Mikrofon orqali yozish"}
                    onClick={() => {
                      if (audioDrafts[q.id]?.recording) {
                        stopQuestionRecording().catch(() => {});
                        return;
                      }
                      startQuestionRecording(q.id).catch((error: any) => toast.error(error?.message || "Audio yozib bo‘lmadi"));
                    }}
                  >
                    <span className="adminAudioActionIcon adminAudioActionIconMic">
                      <Mic className="lucide" aria-hidden="true" />
                    </span>
                    <span className="adminAudioActionText">
                      <span className="adminAudioActionTitle">{audioDrafts[q.id]?.recording ? "Yozilmoqda..." : "Mikrofon"}</span>
                      <span className="adminAudioActionSub">Bosib yozish</span>
                    </span>
                    <ChevronRight className="lucide adminAudioActionArrow" aria-hidden="true" />
                  </button>
                  <label
                    className={`btn btn-sm adminAudioActionCard adminAudioUploadBtn ${audioDrafts[q.id]?.uploading ? "isUploading" : ""}`}
                    htmlFor={`topic-audio-input-${q.id}`}
                    title="Audio fayl yuklash"
                    aria-label="Audio fayl yuklash"
                  >
                    <span className="adminAudioActionIcon adminAudioActionIconUpload">
                      <UploadCloud className="lucide" aria-hidden="true" />
                    </span>
                    <span className="adminAudioActionText">
                      <span className="adminAudioActionTitle">{audioDrafts[q.id]?.blob ? "Faylni almashtirish" : "Audio fayl yuklash"}</span>
                      <span className="adminAudioActionSub">Tayyor faylni tanlang</span>
                    </span>
                    <ChevronRight className="lucide adminAudioActionArrow" aria-hidden="true" />
                  </label>
                  <button
                    className="btn btn-sm adminAudioActionCard adminAudioDeleteBtn"
                    type="button"
                    title="Audio o‘chirish"
                    aria-label="Audio o‘chirish"
                    disabled={!audioDrafts[q.id]?.blob && !q.audio && !audioDrafts[q.id]?.previewUrl}
                    onClick={() => deleteQuestionAudio(q.id).catch((error: any) => toast.error(error?.message || "Audio o‘chirilmadi"))}
                  >
                    <span className="adminAudioActionIcon adminAudioActionIconDelete">
                      <Trash2 className="lucide" aria-hidden="true" />
                    </span>
                    <span className="adminAudioActionText">
                      <span className="adminAudioActionTitle">O‘chirish</span>
                      <span className="adminAudioActionSub">Audioni tozalash</span>
                    </span>
                    <ChevronRight className="lucide adminAudioActionArrow" aria-hidden="true" />
                  </button>
                </div>
                <input
                  id={`topic-audio-input-${q.id}`}
                  className="input adminHiddenFileInput"
                  type="file"
                  accept="audio/*,.mp3,.wav,.ogg,.m4a,.webm"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (!file) return;
                    uploadQuestionAudioFile(q.id, file).catch((error: any) => toast.error(error?.message || "Audio yuklanmadi"));
                    event.currentTarget.value = "";
                  }}
                />
              </div>
            ) : null}
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
        {topicQuestions.map((qq, i) => (
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

      <div className="topicFooter">
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
                    <div className="muted">To‘g‘ri / jami</div>
                    <div className="chartCount">{correct}/{total}</div>
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
