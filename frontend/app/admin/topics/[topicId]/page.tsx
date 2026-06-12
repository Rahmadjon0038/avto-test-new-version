"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, ChevronRight, Mic, Pencil, Plus, Save, Trash2, Upload, UploadCloud } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { useAuth } from "@/app/auth-provider";
import { jsonOrError } from "@/lib/api-authed";

type Question = {
  id: string;
  image: string;
  audio: string;
  text: string;
  options: string[];
  correctIndex: number;
  explanation: string;
};

type AdminTopic = {
  id: string;
  title: string;
  questions: Question[];
};

type ImageDraft = {
  previewUrl: string;
  uploading: boolean;
};

type AudioDraft = {
  previewUrl: string;
  recording: boolean;
  uploading: boolean;
  blob: Blob | null;
  mimeType: string;
};

function createEmptyQuestion(seed: number): Question {
  return {
    id: `q-${Date.now()}-${seed}`,
    image: "",
    audio: "",
    text: "",
    options: ["", ""],
    correctIndex: 0,
    explanation: ""
  };
}

function cloneQuestion(question: Question): Question {
  return {
    id: String(question.id || `q-${Date.now()}`),
    image: String(question.image || ""),
    audio: String(question.audio || ""),
    text: String(question.text || ""),
    options: Array.isArray(question.options) ? question.options.map((option) => String(option || "")) : ["", "", "", ""],
    correctIndex: Number.isFinite(Number(question.correctIndex)) ? Number(question.correctIndex) : 0,
    explanation: String(question.explanation || "")
  };
}

function normalizeQuestionForSave(question: Question): Question {
  return {
    ...question,
    image: String(question.image || "").trim(),
    audio: String(question.audio || "").trim(),
    text: String(question.text || "").trim(),
    explanation: String(question.explanation || "").trim(),
    options: Array.isArray(question.options) ? question.options.map((option) => String(option || "").trim()) : []
  };
}

function parseQuestionImportPayload(rawText: string) {
  const parsed = JSON.parse(rawText);
  const questions = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.questions) ? parsed.questions : null;
  if (!Array.isArray(questions)) throw new Error("JSON array yoki questions massivi yuboring");
  if (!questions.length) throw new Error("Kamida bitta savol kiritilishi kerak");
  return questions;
}

async function persistTopicQuestions(authFetch: ReturnType<typeof useAuth>["authFetch"], topicId: string, nextTopic: AdminTopic) {
  const normalizedQuestions = nextTopic.questions.map(normalizeQuestionForSave);
  for (const question of normalizedQuestions) {
    if (!question.text) throw new Error("Savol matnini kiriting");
    if (!Array.isArray(question.options) || question.options.length < 2) {
      throw new Error("Har bir savolda kamida 2 ta variant bo‘lishi kerak");
    }
    if (question.options.some((option) => !option)) {
      throw new Error("Barcha variantlarni to‘ldiring");
    }
    if (question.correctIndex < 0 || question.correctIndex >= question.options.length) {
      throw new Error("To‘g‘ri javob variantini qayta tanlang");
    }
  }

  const res = await authFetch(`/api/admin/topics/${encodeURIComponent(topicId)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      title: nextTopic.title,
      questions: normalizedQuestions
    })
  });
  return (await jsonOrError(res)) as { topic: AdminTopic };
}

async function fileToDataUrl(file: File) {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Rasmni o‘qib bo‘lmadi"));
    reader.readAsDataURL(file);
  });
}

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

export default function AdminTopicDetailPage() {
  const router = useRouter();
  const params = useParams<{ topicId: string }>();
  const topicId = String(params.topicId || "");
  const qc = useQueryClient();
  const { authFetch } = useAuth();
  const [topic, setTopic] = useState<AdminTopic | null>(null);
  const [importText, setImportText] = useState("[]");
  const [imageDrafts, setImageDrafts] = useState<Record<string, ImageDraft>>({});
  const [audioDrafts, setAudioDrafts] = useState<Record<string, AudioDraft>>({});
  const objectUrlsRef = useRef<Record<string, string>>({});
  const audioObjectUrlsRef = useRef<Record<string, string>>({});
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const mediaChunksRef = useRef<Blob[]>([]);
  const recordingQuestionIdRef = useRef<string | null>(null);
  const [zoomedImage, setZoomedImage] = useState<string | null>(null);

  const topicQuery = useQuery({
    queryKey: ["admin-topic", topicId],
    queryFn: async () => {
      const res = await authFetch(`/api/admin/topics/${encodeURIComponent(topicId)}`);
      const data = (await jsonOrError(res)) as { topic: AdminTopic };
      return data.topic;
    },
    enabled: Boolean(topicId)
  });

  useEffect(() => {
    if (topicQuery.data) {
      setTopic({
        id: String(topicQuery.data.id),
        title: String(topicQuery.data.title || ""),
        questions: Array.isArray(topicQuery.data.questions) ? topicQuery.data.questions.map(cloneQuestion) : []
      });
    }
  }, [topicQuery.data]);

  useEffect(() => {
    return () => {
      Object.values(objectUrlsRef.current).forEach((url) => URL.revokeObjectURL(url));
      objectUrlsRef.current = {};
      Object.values(audioObjectUrlsRef.current).forEach((url) => URL.revokeObjectURL(url));
      audioObjectUrlsRef.current = {};
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
      mediaRecorderRef.current = null;
      mediaChunksRef.current = [];
      recordingQuestionIdRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!zoomedImage) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setZoomedImage(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [zoomedImage]);

  useEffect(() => {
    if (topicQuery.error) toast.error((topicQuery.error as any)?.message || "Xatolik");
  }, [topicQuery.error]);

  const saveMutation = useMutation({
    mutationFn: async (nextTopic: AdminTopic) => {
      return persistTopicQuestions(authFetch, topicId, nextTopic);
    },
    onSuccess: async (data) => {
      setTopic({
        id: String(data.topic.id),
        title: String(data.topic.title || ""),
        questions: Array.isArray(data.topic.questions) ? data.topic.questions.map(cloneQuestion) : []
      });
      await qc.invalidateQueries({ queryKey: ["admin-topics"] });
      await qc.invalidateQueries({ queryKey: ["admin-topic", topicId] });
      toast.success("Saqlandi");
    },
    onError: (error: any) => toast.error(error?.message || "Xatolik")
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const res = await authFetch(`/api/admin/topics/${encodeURIComponent(topicId)}`, {
        method: "DELETE"
      });
      return jsonOrError(res);
    },
    onSuccess: async () => {
      toast.success("Mavzu o‘chirildi");
      await qc.invalidateQueries({ queryKey: ["admin-topics"] });
      router.push("/admin/topics");
    },
    onError: (error: any) => toast.error(error?.message || "Xatolik")
  });

  const deleteQuestionMutation = useMutation({
    mutationFn: async (nextTopic: AdminTopic) => persistTopicQuestions(authFetch, topicId, nextTopic),
    onSuccess: async (data) => {
      setTopic({
        id: String(data.topic.id),
        title: String(data.topic.title || ""),
        questions: Array.isArray(data.topic.questions) ? data.topic.questions.map(cloneQuestion) : []
      });
      await qc.invalidateQueries({ queryKey: ["admin-topics"] });
      await qc.invalidateQueries({ queryKey: ["admin-topic", topicId] });
      toast.success("Savol o‘chirildi");
    },
    onError: (error: any) => toast.error(error?.message || "Xatolik")
  });

  const importMutation = useMutation({
    mutationFn: async () => {
      const questions = parseQuestionImportPayload(importText);
      const res = await authFetch(`/api/admin/topics/${encodeURIComponent(topicId)}/import-questions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ questions })
      });
      return (await jsonOrError(res)) as { topic: AdminTopic };
    },
    onSuccess: async (data) => {
      setTopic({
        id: String(data.topic.id),
        title: String(data.topic.title || ""),
        questions: Array.isArray(data.topic.questions) ? data.topic.questions.map(cloneQuestion) : []
      });
      setImportText("[]");
      await qc.invalidateQueries({ queryKey: ["admin-topics"] });
      await qc.invalidateQueries({ queryKey: ["admin-topic", topicId] });
      toast.success("Savollar import qilindi");
    },
    onError: (error: any) => toast.error(error?.message || "Xatolik")
  });

  const clearQuestionsMutation = useMutation({
    mutationFn: async () => {
      if (!topic) throw new Error("Mavzu topilmadi");
      return persistTopicQuestions(authFetch, topicId, {
        ...topic,
        questions: []
      });
    },
    onSuccess: async (data) => {
      setTopic({
        id: String(data.topic.id),
        title: String(data.topic.title || ""),
        questions: []
      });
      await qc.invalidateQueries({ queryKey: ["admin-topics"] });
      await qc.invalidateQueries({ queryKey: ["admin-topic", topicId] });
      toast.success("Barcha savollar o‘chirildi");
    },
    onError: (error: any) => toast.error(error?.message || "Xatolik")
  });

  async function uploadQuestionImage(questionId: string, file: File) {
    const acceptedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
    if (!acceptedTypes.has(file.type)) {
      throw new Error("Faqat jpg, jpeg, png va webp formatlar qabul qilinadi");
    }
    if (file.size > 5 * 1024 * 1024) {
      throw new Error("Rasm hajmi 5MB dan oshmasligi kerak");
    }

    const oldPreviewUrl = objectUrlsRef.current[questionId];
    if (oldPreviewUrl) URL.revokeObjectURL(oldPreviewUrl);

    const previewUrl = URL.createObjectURL(file);
    objectUrlsRef.current[questionId] = previewUrl;

    setImageDrafts((prev) => ({
      ...prev,
      [questionId]: { previewUrl, uploading: true }
    }));

    const currentImage = topic?.questions.find((question) => question.id === questionId)?.image || "";
    const imageBase64 = await fileToDataUrl(file);

    const res = await authFetch("/api/upload-image", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        imageBase64,
        imageName: file.name,
        imageType: file.type,
        topicId,
        questionId,
        oldImageUrl: currentImage
      })
    });
    const data = await jsonOrError(res);
    const imageUrl = String(data?.imageUrl || "").trim();
    if (!imageUrl) throw new Error("Rasm yuklanmadi");

    const previewObjectUrl = objectUrlsRef.current[questionId];
    if (previewObjectUrl) {
      URL.revokeObjectURL(previewObjectUrl);
      delete objectUrlsRef.current[questionId];
    }

    setTopic((prev) =>
      prev
        ? {
            ...prev,
            questions: prev.questions.map((question) => (question.id === questionId ? { ...question, image: imageUrl } : question))
          }
        : prev
    );

    setImageDrafts((prev) => ({
      ...prev,
      [questionId]: { previewUrl: imageUrl, uploading: false }
    }));

    toast.success("Rasm yuklandi");
    return imageUrl;
  }

  async function deleteQuestionImage(questionId: string) {
    const currentImage = topic?.questions.find((question) => question.id === questionId)?.image || "";
    const res = await authFetch("/api/upload-image", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        topicId,
        questionId,
        imageUrl: currentImage
      })
    });
    const data = await jsonOrError(res);
    const imageUrl = String(data?.imageUrl || "").trim();

    setTopic((prev) =>
      prev
        ? {
            ...prev,
            questions: prev.questions.map((question) => (question.id === questionId ? { ...question, image: imageUrl } : question))
          }
        : prev
    );

    setImageDrafts((prev) => {
      const next = { ...prev };
      delete next[questionId];
      return next;
    });

    toast.success("Rasm o‘chirildi");
  }

  function handleQuestionImagePick(questionId: string, file: File | undefined) {
    if (!file) return;
    uploadQuestionImage(questionId, file).catch((error: any) => {
      toast.error(error?.message || "Rasm yuklanmadi");
      const previousObjectUrl = objectUrlsRef.current[questionId];
      if (previousObjectUrl) {
        URL.revokeObjectURL(previousObjectUrl);
        delete objectUrlsRef.current[questionId];
      }
      setImageDrafts((prev) => {
        const next = { ...prev };
        delete next[questionId];
        return next;
      });
    });
  }

  function cleanupAudioPreview(questionId: string) {
    const previousUrl = audioObjectUrlsRef.current[questionId];
    if (previousUrl) {
      URL.revokeObjectURL(previousUrl);
      delete audioObjectUrlsRef.current[questionId];
    }
  }

  function cleanupQuestionDrafts(questionId: string) {
    cleanupAudioPreview(questionId);
    const previousImageUrl = objectUrlsRef.current[questionId];
    if (previousImageUrl) {
      URL.revokeObjectURL(previousImageUrl);
      delete objectUrlsRef.current[questionId];
    }
    setImageDrafts((prev) => {
      const next = { ...prev };
      delete next[questionId];
      return next;
    });
    setAudioDrafts((prev) => {
      const next = { ...prev };
      delete next[questionId];
      return next;
    });
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

  if (!topic && !topicQuery.isLoading) {
    return (
      <section className="adminEmpty card">
        <div className="adminEmptyTitle">Mavzu topilmadi</div>
        <div className="adminEmptyText">Tanlangan mavzu mavjud emas.</div>
        <button className="btn btn-primary" type="button" onClick={() => router.push("/admin/topics")}>
          <ArrowLeft className="lucide" aria-hidden="true" /> Ro‘yxatga qaytish
        </button>
      </section>
    );
  }

  return (
    <section className="adminSectionPage">
      <div className="adminSectionHeader">
        <div className="adminTopicActions">
          <button className="btn btn-ghost" type="button" onClick={() => router.push("/admin/topics")}>
            <ArrowLeft className="lucide" aria-hidden="true" /> Orqaga
          </button>
          <button className="btn btn-danger" type="button" onClick={() => deleteMutation.mutate()} disabled={deleteMutation.isPending}>
            <Trash2 className="lucide" aria-hidden="true" /> O‘chirish
          </button>
        </div>
      </div>

      <div className="card adminPanelCard">
        <div className="adminPanelCardHead">
          <div className="adminPanelCardTitle">Mavzu ma’lumoti</div>
        </div>

        <div className="adminFieldGroup">
          <label className="adminField">
            <span className="adminFieldLabel">Mavzu nomi</span>
            <input
              className="input"
              value={topic?.title || ""}
              onChange={(event) => setTopic((prev) => (prev ? { ...prev, title: event.target.value } : prev))}
              placeholder="Masalan: Umumiy qoidalar"
            />
          </label>
        </div>
      </div>

      <div className="card adminPanelCard">
        <div className="adminPanelCardHead">
          <div className="adminPanelCardTitle">
            <Upload className="lucide" aria-hidden="true" /> JSON import
          </div>
        </div>

        <div className="adminFieldGroup">
          <div className="adminFieldLabel">
            JSON ichiga savollar massivi yuboring. Har bir savolda text, options, correctIndex, explanation, image va audio bo‘lishi mumkin.
            id yubormang, backend uni avtomatik yaratadi.
          </div>
          <textarea
            className="input adminTextarea"
            rows={9}
            value={importText}
            onChange={(event) => setImportText(event.target.value)}
            placeholder={`[\n  {\n    "correctIndex": 1,\n    "explanation": "",\n    "image": "",\n    "audio": "",\n    "options": ["Variant 1", "Variant 2"],\n    "text": "Savol matni"\n  }\n]`}
          />
        </div>

        <div className="adminOptionsToolbar">
          <button className="btn btn-primary" type="button" onClick={() => importMutation.mutate()} disabled={importMutation.isPending}>
            <Upload className="lucide" aria-hidden="true" /> Import qilish
          </button>
        </div>
      </div>

      <div className="adminQuestionsHeader">
        <div className="adminPanelCardTitle">Savollar</div>
        <div className="adminTopicActions">
          <button
            className="btn btn-danger"
            type="button"
            onClick={() => {
              const count = topic?.questions?.length || 0;
              if (!count) return toast("O‘chirish uchun savol yo‘q");
              if (!window.confirm(`Mavzudagi barcha ${count} ta savolni o‘chirishni tasdiqlaysizmi? Bu bazadan o‘chadi.`)) return;
              clearQuestionsMutation.mutate();
            }}
            disabled={clearQuestionsMutation.isPending || !topic?.questions?.length}
          >
            <Trash2 className="lucide" aria-hidden="true" /> Hammasini o‘chirish
          </button>
          <button className="btn btn-primary" type="button" onClick={() => setTopic((prev) => (prev ? { ...prev, questions: [...prev.questions, createEmptyQuestion(prev.questions.length + 1)] } : prev))}>
            <Plus className="lucide" aria-hidden="true" /> Savol qo‘shish
          </button>
        </div>
      </div>

      <div className="adminQuestionsGrid">
        {topic?.questions?.length ? (
          topic.questions.map((question, index) => (
            <article key={question.id} className="card adminQuestionCard">
              <div className="adminQuestionHead">
                <div className="adminQuestionBadge">Savol {index + 1}</div>
                <button
                  className="btn btn-sm"
                  type="button"
                  onClick={() => {
                    if (!topic) return;
                    const nextQuestions = topic.questions.filter((item) => item.id !== question.id);
                    if (!window.confirm("Bu savolni bazadan o‘chirishni tasdiqlaysizmi?")) return;
                    cleanupQuestionDrafts(question.id);
                    deleteQuestionMutation.mutate({
                      ...topic,
                      questions: nextQuestions
                    });
                  }}
                  disabled={deleteQuestionMutation.isPending}
                >
                  <Trash2 className="lucide" aria-hidden="true" /> O‘chirish
                </button>
              </div>

              <div className="adminQuestionFields">
                <div className="adminField adminFieldWide">
                  <div className="adminFieldLabel">Rasm</div>
                  <div className="adminImageRow">
                    <div className="adminImagePreview adminImagePreviewSmall">
                      {imageDrafts[question.id]?.previewUrl || question.image ? (
                        <button
                          className="adminImagePreviewButton adminImagePreviewButtonInner"
                          type="button"
                          onClick={() => setZoomedImage(imageDrafts[question.id]?.previewUrl || question.image || "")}
                          aria-label="Rasmni kattalashtirish"
                        >
                          <img
                            className="adminImagePreviewImg"
                            src={imageDrafts[question.id]?.previewUrl || question.image || ""}
                            alt="Rasm preview"
                          />
                        </button>
                      ) : (
                        <div className="adminImageEmptyState">
                          <div className="adminImageEmptyTitle">Rasm yuklanmagan</div>
                          <div className="adminImageEmptyText">Chapdagi tugma orqali rasm tanlang.</div>
                        </div>
                      )}
                      {imageDrafts[question.id]?.uploading ? <div className="adminImagePreviewLoading">Yuklanmoqda...</div> : null}
                    </div>

                    <div className="adminImageControls">
                      <div className="adminImageUploadHint">jpg, jpeg, png, webp — 5MB gacha</div>
                      <div className="adminOptionsToolbar">
                        <label
                          className="btn btn-sm adminImageUploadBtn adminIconBtnEdit"
                          htmlFor={`image-input-${question.id}`}
                          title={question.image || imageDrafts[question.id]?.previewUrl ? "Rasmni yangilash" : "Rasm yuklash"}
                          aria-label={question.image || imageDrafts[question.id]?.previewUrl ? "Rasmni yangilash" : "Rasm yuklash"}
                        >
                          {question.image || imageDrafts[question.id]?.previewUrl ? (
                            <Pencil className="lucide" aria-hidden="true" />
                          ) : (
                            <Plus className="lucide" aria-hidden="true" />
                          )}
                          <span>{question.image || imageDrafts[question.id]?.previewUrl ? "Rasm yangilash" : "Rasm yuklash"}</span>
                        </label>
                        <button
                          className="btn btn-sm adminIconBtn adminIconBtnDelete"
                          type="button"
                          title="Rasmni o‘chirish"
                          aria-label="Rasmni o‘chirish"
                          disabled={!question.image && !imageDrafts[question.id]?.previewUrl}
                          onClick={() => deleteQuestionImage(question.id)}
                        >
                          <Trash2 className="lucide" aria-hidden="true" />
                        </button>
                      </div>
                      <input
                        id={`image-input-${question.id}`}
                        className="input adminHiddenFileInput"
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          handleQuestionImagePick(question.id, file);
                          event.currentTarget.value = "";
                        }}
                      />
                    </div>
                </div>
              </div>

                <label className="adminField adminFieldWide">
                  <span className="adminFieldLabel">Savol matni</span>
                  <input
                    className="input"
                    value={question.text}
                    onChange={(event) =>
                      setTopic((prev) =>
                        prev
                          ? {
                              ...prev,
                              questions: prev.questions.map((item) => (item.id === question.id ? { ...item, text: event.target.value } : item))
                            }
                          : prev
                      )
                    }
                    placeholder="Savol matni"
                  />
                </label>

                <label className="adminField adminFieldWide">
                  <span className="adminFieldLabel">Izoh</span>
                  <textarea
                    className="input adminTextarea"
                    rows={7}
                    value={question.explanation}
                    onChange={(event) =>
                      setTopic((prev) =>
                        prev
                          ? {
                              ...prev,
                              questions: prev.questions.map((item) =>
                                item.id === question.id ? { ...item, explanation: event.target.value } : item
                              )
                            }
                          : prev
                      )
                    }
                    placeholder="Markdown yozing: **qalin**, *qiya*, - ro‘yxat"
                    />
                </label>

                <div className="adminField adminFieldWide">
                  <div className="adminFieldLabel">Audio izoh</div>
                  <div className="adminAudioStack">
                    <div className="adminAudioPreview">
                      {audioDrafts[question.id]?.recording ? (
                        <div className="adminAudioEmptyState">
                          <div className="adminAudioEmptyTitle">Yozib olinmoqda</div>
                          <div className="adminAudioEmptyText">Mikrofon tugmasini bosib turing.</div>
                        </div>
                      ) : audioDrafts[question.id]?.previewUrl || question.audio ? (
                        <audio
                          className="adminAudioPlayer"
                          controls
                          preload="metadata"
                          src={audioDrafts[question.id]?.previewUrl || question.audio}
                        />
                      ) : (
                        <div className="adminAudioEmptyState">
                          <div className="adminAudioEmptyTitle">Audio yuklanmagan</div>
                          <div className="adminAudioEmptyText">Mikrofonga bosib yozing yoki mavjud audioni tinglang.</div>
                        </div>
                      )}
                      {audioDrafts[question.id]?.uploading ? <div className="adminImagePreviewLoading">Yuklanmoqda...</div> : null}
                    </div>

                  <div className="adminAudioFooter">
                      <div className="adminAudioHint">
                        Bosib turing — yozish boshlanadi. Qo‘yib yuborsangiz audio tayyor bo‘ladi. Yoki tayyor audio faylni yuklang.
                      </div>
                      <div className="adminOptionsToolbar adminAudioButtons">
                        <button
                          className={`btn btn-sm adminAudioActionCard adminAudioMicBtn ${audioDrafts[question.id]?.recording ? "isRecording" : ""}`}
                          type="button"
                          title={audioDrafts[question.id]?.recording ? "Yozish davom etmoqda" : "Bosib turib yozing"}
                          aria-label={audioDrafts[question.id]?.recording ? "Yozish davom etmoqda" : "Bosib turib yozing"}
                          onPointerDown={(event) => {
                            event.preventDefault();
                            startQuestionRecording(question.id).catch((error: any) => toast.error(error?.message || "Audio yozib bo‘lmadi"));
                          }}
                          onPointerUp={() => {
                            stopQuestionRecording().catch(() => {});
                          }}
                          onPointerCancel={() => {
                            stopQuestionRecording().catch(() => {});
                          }}
                          onPointerLeave={() => {
                            if (audioDrafts[question.id]?.recording) stopQuestionRecording().catch(() => {});
                          }}
                        >
                          <span className="adminAudioActionIcon adminAudioActionIconMic">
                            <Mic className="lucide" aria-hidden="true" />
                          </span>
                          <span className="adminAudioActionText">
                            <span className="adminAudioActionTitle">{audioDrafts[question.id]?.recording ? "Yozilmoqda..." : "Mikrofon"}</span>
                            <span className="adminAudioActionSub">Bosib turing, yozish uchun</span>
                          </span>
                          <ChevronRight className="lucide adminAudioActionArrow" aria-hidden="true" />
                        </button>
                        <label
                          className={`btn btn-sm adminAudioActionCard adminAudioUploadBtn ${audioDrafts[question.id]?.uploading ? "isUploading" : ""}`}
                          htmlFor={`audio-input-${question.id}`}
                          title="Tayyor audio faylni yuklash"
                          aria-label="Tayyor audio faylni yuklash"
                        >
                          <span className="adminAudioActionIcon adminAudioActionIconUpload">
                            <UploadCloud className="lucide" aria-hidden="true" />
                          </span>
                          <span className="adminAudioActionText">
                            <span className="adminAudioActionTitle">{audioDrafts[question.id]?.blob ? "Faylni almashtirish" : "Audio fayl yuklash"}</span>
                            <span className="adminAudioActionSub">Tayyor audio faylni tanlang</span>
                          </span>
                          <ChevronRight className="lucide adminAudioActionArrow" aria-hidden="true" />
                        </label>
                        <button
                          className="btn btn-sm adminAudioActionCard adminAudioDeleteBtn"
                          type="button"
                          title="Audio o‘chirish"
                          aria-label="Audio o‘chirish"
                          disabled={!audioDrafts[question.id]?.blob && !question.audio && !audioDrafts[question.id]?.previewUrl}
                          onClick={() => deleteQuestionAudio(question.id).catch((error: any) => toast.error(error?.message || "Audio o‘chirilmadi"))}
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
                        id={`audio-input-${question.id}`}
                        className="input adminHiddenFileInput"
                        type="file"
                        accept="audio/*,.mp3,.wav,.ogg,.m4a,.webm"
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          if (!file) return;
                          uploadQuestionAudioFile(question.id, file).catch((error: any) => toast.error(error?.message || "Audio yuklanmadi"));
                          event.currentTarget.value = "";
                        }}
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div className="adminOptionsGrid">
                {question.options.map((option, optionIndex) => (
                  <label key={optionIndex} className="adminField">
                    <span className="adminFieldLabel">Variant {optionIndex + 1}</span>
                    <input
                      className="input"
                      value={option}
                      onChange={(event) =>
                        setTopic((prev) =>
                          prev
                            ? {
                                ...prev,
                                questions: prev.questions.map((item) =>
                                  item.id === question.id
                                    ? {
                                        ...item,
                                        options: item.options.map((value, idx) => (idx === optionIndex ? event.target.value : value))
                                      }
                                    : item
                                )
                              }
                            : prev
                        )
                      }
                      placeholder={`Variant ${optionIndex + 1}`}
                    />
                  </label>
                ))}
              </div>

              <div className="adminOptionsToolbar">
                <button
                  className="btn btn-sm"
                  type="button"
                  onClick={() =>
                    setTopic((prev) =>
                      prev
                        ? {
                            ...prev,
                            questions: prev.questions.map((item) =>
                              item.id === question.id ? { ...item, options: [...item.options, ""] } : item
                            )
                          }
                        : prev
                    )
                  }
                >
                  <Plus className="lucide" aria-hidden="true" /> Variant qo‘shish
                </button>
                <button
                  className="btn btn-sm"
                  type="button"
                  disabled={question.options.length <= 2}
                  onClick={() =>
                    setTopic((prev) =>
                      prev
                        ? {
                            ...prev,
                            questions: prev.questions.map((item) => {
                              if (item.id !== question.id) return item;
                              const nextOptions = item.options.slice(0, -1);
                              const nextCorrectIndex = Math.min(item.correctIndex, nextOptions.length - 1);
                              return {
                                ...item,
                                options: nextOptions,
                                correctIndex: Math.max(0, nextCorrectIndex)
                              };
                            })
                          }
                        : prev
                    )
                  }
                >
                  Variant olib tashlash
                </button>
              </div>

              <label className="adminField adminFieldWide">
                <span className="adminFieldLabel">To‘g‘ri javob</span>
                <select
                  className="input"
                  value={String(question.correctIndex)}
                  onChange={(event) =>
                    setTopic((prev) =>
                      prev
                        ? {
                            ...prev,
                            questions: prev.questions.map((item) =>
                              item.id === question.id ? { ...item, correctIndex: Number(event.target.value) } : item
                            )
                          }
                        : prev
                    )
                  }
                >
                  {question.options.map((_, optionIndex) => (
                    <option key={optionIndex} value={optionIndex}>
                      {optionIndex + 1}-variant
                    </option>
                  ))}
                </select>
              </label>
            </article>
          ))
        ) : (
          <section className="card adminEmpty adminEmptyCompact">
            <div className="adminEmptyTitle">Savollar yo‘q</div>
            <div className="adminEmptyText">Birinchi savolni qo‘shish uchun yuqoridagi tugmadan foydalaning.</div>
          </section>
        )}
      </div>

      <button className="btn btn-primary adminSaveFloating" type="button" onClick={() => topic && saveMutation.mutate(topic)} disabled={saveMutation.isPending || !topic}>
        <Save className="lucide" aria-hidden="true" /> Saqlash
      </button>

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
