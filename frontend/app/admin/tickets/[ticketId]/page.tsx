"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Pencil, Plus, Save, Ticket, Trash2 } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { useAuth } from "@/app/auth-provider";
import { jsonOrError } from "@/lib/api-authed";
import { broadcastQuerySync } from "@/app/query-provider";
import { DEFAULT_LANGUAGE, LANGUAGE_OPTIONS, type LanguageCode } from "@/lib/site-language";

type QuestionLocale = {
  text?: string;
  image?: string;
  audio?: string;
  options?: string[];
  correctIndex?: number;
  explanation?: string;
};

type Question = {
  id: string;
  image: string;
  text: string;
  options: string[];
  correctIndex: number;
  explanation: string;
  i18n?: Record<string, QuestionLocale>;
};

type LocaleView = {
  text: string;
  options: string[];
  correctIndex: number;
  explanation: string;
  hasTranslation: boolean;
};

function getLocaleView(question: Question, lang: LanguageCode): LocaleView {
  if (lang === DEFAULT_LANGUAGE) {
    return {
      text: question.text,
      options: question.options,
      correctIndex: question.correctIndex,
      explanation: question.explanation,
      hasTranslation: true
    };
  }
  const entry = question.i18n?.[lang];
  const hasTranslation = Boolean(entry && (String(entry.text || "").trim() || (entry.options || []).some((option) => String(option || "").trim())));
  return {
    text: entry?.text || "",
    options:
      Array.isArray(entry?.options) && entry.options.length === question.options.length
        ? entry.options
        : question.options.map(() => ""),
    correctIndex: Number.isFinite(Number(entry?.correctIndex)) ? Number(entry?.correctIndex) : question.correctIndex,
    explanation: entry?.explanation || "",
    hasTranslation
  };
}

function updateQuestionLocaleText(question: Question, lang: LanguageCode, field: "text" | "explanation", value: string): Question {
  if (lang === DEFAULT_LANGUAGE) return { ...question, [field]: value };
  const current = question.i18n?.[lang] || {};
  return { ...question, i18n: { ...question.i18n, [lang]: { ...current, [field]: value } } };
}

function updateQuestionLocaleOption(question: Question, lang: LanguageCode, optionIndex: number, value: string): Question {
  if (lang === DEFAULT_LANGUAGE) {
    return { ...question, options: question.options.map((option, index) => (index === optionIndex ? value : option)) };
  }
  const current = question.i18n?.[lang] || {};
  const baseOptions =
    Array.isArray(current.options) && current.options.length === question.options.length
      ? current.options
      : question.options.map(() => "");
  return {
    ...question,
    i18n: { ...question.i18n, [lang]: { ...current, options: baseOptions.map((option, index) => (index === optionIndex ? value : option)) } }
  };
}

function updateQuestionLocaleCorrectIndex(question: Question, lang: LanguageCode, value: number): Question {
  if (lang === DEFAULT_LANGUAGE) return { ...question, correctIndex: value };
  const current = question.i18n?.[lang] || {};
  return { ...question, i18n: { ...question.i18n, [lang]: { ...current, correctIndex: value } } };
}

const NON_DEFAULT_LANGUAGES = LANGUAGE_OPTIONS.map((option) => option.code).filter((code) => code !== DEFAULT_LANGUAGE);
const DEFAULT_OPTION_COUNT = 4;

function addOptionAcrossLocales(question: Question): Question {
  const nextOptions = [...question.options, ""];
  const nextI18n = { ...(question.i18n || {}) };
  for (const lang of NON_DEFAULT_LANGUAGES) {
    const entry = nextI18n[lang];
    if (entry) {
      const entryOptions = Array.isArray(entry.options) ? entry.options.map((option) => String(option || "")) : question.options.map(() => "");
      nextI18n[lang] = { ...entry, options: [...entryOptions, ""] };
    }
  }
  return { ...question, options: nextOptions, i18n: nextI18n };
}

function removeOptionAcrossLocales(question: Question): Question {
  const nextOptions = question.options.slice(0, -1);
  const nextCorrectIndex = Math.max(0, Math.min(question.correctIndex, nextOptions.length - 1));
  const nextI18n = { ...(question.i18n || {}) };
  for (const lang of NON_DEFAULT_LANGUAGES) {
    const entry = nextI18n[lang];
    if (entry) {
      const entryOptions = Array.isArray(entry.options) ? entry.options.map((option) => String(option || "")) : question.options.map(() => "");
      const trimmedOptions = entryOptions.slice(0, -1);
      const entryCorrectIndex = Number.isFinite(Number(entry.correctIndex))
        ? Math.max(0, Math.min(Number(entry.correctIndex), trimmedOptions.length - 1))
        : entry.correctIndex;
      nextI18n[lang] = { ...entry, options: trimmedOptions, correctIndex: entryCorrectIndex };
    }
  }
  return { ...question, options: nextOptions, correctIndex: nextCorrectIndex, i18n: nextI18n };
}

type AdminTicket = {
  id: string;
  title: string;
  questions: Array<Question | null>;
};

type ImageDraft = {
  previewUrl: string;
  uploading: boolean;
};

function createEmptyQuestion(seed: number): Question {
  return {
    id: `q-${Date.now()}-${seed}`,
    image: "",
    text: "",
    options: Array.from({ length: DEFAULT_OPTION_COUNT }, () => ""),
    correctIndex: 0,
    explanation: ""
  };
}

function cloneQuestion(question: Question): Question {
  return {
    id: String(question.id || `q-${Date.now()}`),
    image: String(question.image || ""),
    text: String(question.text || ""),
    options: Array.isArray(question.options) ? question.options.map((option) => String(option || "")) : ["", "", "", ""],
    correctIndex: Number.isFinite(Number(question.correctIndex)) ? Number(question.correctIndex) : 0,
    explanation: String(question.explanation || ""),
    i18n: question.i18n ? JSON.parse(JSON.stringify(question.i18n)) : undefined
  };
}

function cloneQuestionSlot(question: Question | null): Question | null {
  return question ? cloneQuestion(question) : null;
}

function normalizeQuestionForSave(question: Question): Question {
  const i18n: Record<string, QuestionLocale> = {};
  for (const [lang, entry] of Object.entries(question.i18n || {})) {
    if (!entry || typeof entry !== "object") continue;
    i18n[lang] = {
      text: String(entry.text || "").trim(),
      image: String(question.image || "").trim(),
      audio: String(entry.audio || "").trim(),
      options: Array.isArray(entry.options) ? entry.options.map((option) => String(option || "").trim()) : [],
      correctIndex: Number.isFinite(Number(entry.correctIndex)) ? Number(entry.correctIndex) : 0,
      explanation: String(entry.explanation || "").trim()
    };
  }
  return {
    ...question,
    image: String(question.image || "").trim(),
    text: String(question.text || "").trim(),
    explanation: String(question.explanation || "").trim(),
    options: Array.isArray(question.options) ? question.options.map((option) => String(option || "").trim()) : [],
    i18n
  };
}

async function fileToDataUrl(file: File) {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Rasmni o‘qib bo‘lmadi"));
    reader.readAsDataURL(file);
  });
}

export default function AdminTicketDetailPage() {
  const router = useRouter();
  const params = useParams<{ ticketId: string }>();
  const ticketId = String(params.ticketId || "");
  const qc = useQueryClient();
  const { authFetch } = useAuth();
  const [ticket, setTicket] = useState<AdminTicket | null>(null);
  const [imageDrafts, setImageDrafts] = useState<Record<string, ImageDraft>>({});
  const objectUrlsRef = useRef<Record<string, string>>({});
  const [zoomedImage, setZoomedImage] = useState<string | null>(null);

  const ticketQuery = useQuery({
    queryKey: ["admin-ticket", ticketId],
    queryFn: async () => {
      const res = await authFetch(`/api/admin/tickets/${encodeURIComponent(ticketId)}`);
      const data = (await jsonOrError(res)) as { ticket: AdminTicket };
      return data.ticket;
    },
    enabled: Boolean(ticketId)
  });

  useEffect(() => {
    if (ticketQuery.data) {
      const rawQuestions = Array.isArray(ticketQuery.data.questions) ? ticketQuery.data.questions : [];
      setTicket({
        id: String(ticketQuery.data.id),
        title: String(ticketQuery.data.title || ""),
        questions: Array.from({ length: 20 }, (_, index) => cloneQuestionSlot(rawQuestions[index] || null))
      });
    }
  }, [ticketQuery.data]);

  useEffect(() => {
    return () => {
      Object.values(objectUrlsRef.current).forEach((url) => URL.revokeObjectURL(url));
      objectUrlsRef.current = {};
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
    if (ticketQuery.error) toast.error((ticketQuery.error as any)?.message || "Xatolik");
  }, [ticketQuery.error]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!ticket) throw new Error("Ticket topilmadi");
      const normalizedQuestions = ticket.questions.map((question) => (question ? normalizeQuestionForSave(question) : null));
      for (const question of normalizedQuestions) {
        if (!question) continue;
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
      const res = await authFetch(`/api/admin/tickets/${encodeURIComponent(ticketId)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: ticket.title,
          questions: normalizedQuestions
        })
      });
      return (await jsonOrError(res)) as { ticket: AdminTicket };
    },
    onSuccess: async (data) => {
      const rawQuestions = Array.isArray(data.ticket.questions) ? data.ticket.questions : [];
      setTicket({
        id: String(data.ticket.id),
        title: String(data.ticket.title || ""),
        questions: Array.from({ length: 20 }, (_, index) => cloneQuestionSlot(rawQuestions[index] || null))
      });
      await qc.invalidateQueries({ queryKey: ["admin-tickets"] });
      await qc.invalidateQueries({ queryKey: ["admin-ticket", ticketId] });
      broadcastQuerySync({ type: "invalidate", queryKey: ["ticket", ticketId] });
      broadcastQuerySync({ type: "invalidate", queryKey: ["tickets"] });
      toast.success("Saqlandi");
    },
    onError: (error: any) => toast.error(error?.message || "Xatolik")
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const res = await authFetch(`/api/admin/tickets/${encodeURIComponent(ticketId)}`, {
        method: "DELETE"
      });
      return jsonOrError(res);
    },
    onSuccess: async () => {
      toast.success("Bilet o‘chirildi");
      await qc.invalidateQueries({ queryKey: ["admin-tickets"] });
      broadcastQuerySync({ type: "invalidate", queryKey: ["ticket", ticketId] });
      broadcastQuerySync({ type: "invalidate", queryKey: ["tickets"] });
      router.push("/admin/tickets");
    },
    onError: (error: any) => toast.error(error?.message || "Xatolik")
  });

  const questionCount = useMemo(() => ticket?.questions?.filter(Boolean).length || 0, [ticket]);

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

    const currentImage = ticket?.questions.find((question) => question?.id === questionId)?.image || "";
    const imageBase64 = await fileToDataUrl(file);

    const res = await authFetch("/api/upload-image", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        imageBase64,
        imageName: file.name,
        imageType: file.type,
        ticketId,
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

    setTicket((prev) =>
      prev
        ? {
            ...prev,
            questions: prev.questions.map((question) => (question && question.id === questionId ? { ...question, image: imageUrl } : question))
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
    const currentImage = ticket?.questions.find((question) => question?.id === questionId)?.image || "";
    const res = await authFetch("/api/upload-image", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ticketId,
        questionId,
        imageUrl: currentImage
      })
    });
    const data = await jsonOrError(res);
    const imageUrl = String(data?.imageUrl || "").trim();

    setTicket((prev) =>
      prev
        ? {
            ...prev,
            questions: prev.questions.map((question) => (question && question.id === questionId ? { ...question, image: imageUrl } : question))
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

  if (!ticket && !ticketQuery.isLoading) {
    return (
      <section className="adminEmpty card">
        <div className="adminEmptyTitle">Bilet topilmadi</div>
        <div className="adminEmptyText">Tanlangan bilet mavjud emas.</div>
        <button className="btn btn-primary" type="button" onClick={() => router.push("/admin/tickets")}>
          <ArrowLeft className="lucide" aria-hidden="true" /> Ro‘yxatga qaytish
        </button>
      </section>
    );
  }

  return (
    <section className="adminSectionPage">
      <div className="adminSectionHeader">
        <div className="adminTicketActions">
          <button className="btn btn-ghost" type="button" onClick={() => router.push("/admin/tickets")}>
            <ArrowLeft className="lucide" aria-hidden="true" /> Orqaga
          </button>
          <button className="btn btn-ghost" type="button" onClick={() => router.push(`/admin/ticket-builder?ticketId=${encodeURIComponent(ticketId)}`)}>
            <Ticket className="lucide" aria-hidden="true" /> Constructorda ochish
          </button>
          <button className="btn btn-danger" type="button" onClick={() => deleteMutation.mutate()} disabled={deleteMutation.isPending}>
            <Trash2 className="lucide" aria-hidden="true" /> O‘chirish
          </button>
        </div>
      </div>

      <div className="card adminPanelCard">
        <div className="adminPanelCardHead">
          <div className="adminPanelCardTitle">Bilet ma’lumoti</div>
        </div>

        <div className="adminFieldGroup">
          <label className="adminField">
            <span className="adminFieldLabel">Bilet nomi</span>
            <input
              className="input"
              value={ticket?.title || ""}
              onChange={(event) => setTicket((prev) => (prev ? { ...prev, title: event.target.value } : prev))}
              placeholder="Masalan: 6-bilet"
            />
          </label>
        </div>
      </div>

      <div className="adminQuestionsHeader">
        <div className="adminPanelCardTitle">Savollar</div>
        <button
          className="btn btn-primary"
          type="button"
          onClick={() =>
            setTicket((prev) =>
              prev
                ? {
                    ...prev,
                    questions: prev.questions.some((item) => !item)
                      ? prev.questions.map((item, index) => (item ? item : index === prev.questions.findIndex((slot) => !slot) ? createEmptyQuestion(index + 1) : item))
                      : [...prev.questions, createEmptyQuestion(prev.questions.length + 1)]
                  }
                : prev
            )
          }
        >
          <Plus className="lucide" aria-hidden="true" /> Bo‘sh slotni to‘ldirish
        </button>
      </div>

      <div className="adminQuestionsGrid">
        {ticket?.questions?.length ? (
          ticket.questions.map((question, index) => {
            if (!question) {
              return (
                <article key={`empty-${index}`} className="card adminQuestionCard adminEmptyQuestionCard">
                  <div className="adminQuestionHead">
                    <div className="adminQuestionBadge">Savol {index + 1}</div>
                    <button
                      className="btn btn-sm btn-primary"
                      type="button"
                      onClick={() =>
                        setTicket((prev) =>
                          prev
                            ? {
                                ...prev,
                                questions: prev.questions.map((item, slotIndex) => (slotIndex === index ? createEmptyQuestion(index + 1) : item))
                              }
                            : prev
                        )
                      }
                    >
                      <Plus className="lucide" aria-hidden="true" /> To‘ldirish
                    </button>
                  </div>
                  <div className="adminEmptyText" style={{ paddingTop: 8 }}>
                    Bu slot bo‘sh. Keyinroq savol qo‘shishingiz mumkin.
                  </div>
                </article>
              );
            }
            return (
              <article key={question.id} className="card adminQuestionCard">
                <div className="adminQuestionHead">
                  <div className="adminQuestionBadge">Savol {index + 1}</div>
                  <button
                    className="btn btn-sm"
                    type="button"
                    onClick={() =>
                      setTicket((prev) =>
                        prev
                          ? {
                              ...prev,
                              questions: prev.questions.map((item, slotIndex) => (slotIndex === index ? null : item))
                            }
                          : prev
                      )
                    }
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

              </div>

              <div className="adminOptionsToolbar">
                <button
                  className="btn btn-sm"
                  type="button"
                  onClick={() =>
                    setTicket((prev) =>
                      prev
                        ? {
                            ...prev,
                            questions: prev.questions.map((item) => (item && item.id === question.id ? addOptionAcrossLocales(item) : item))
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
                    setTicket((prev) =>
                      prev
                        ? {
                            ...prev,
                            questions: prev.questions.map((item) => (item && item.id === question.id ? removeOptionAcrossLocales(item) : item))
                          }
                        : prev
                    )
                  }
                >
                  Variant olib tashlash
                </button>
              </div>

              {LANGUAGE_OPTIONS.map((langOption) => {
                const locale = getLocaleView(question, langOption.code);
                return (
                  <div key={langOption.code} className="adminLocaleSection">
                    <div className="adminLocaleSectionTitle">
                      {langOption.label}
                      {langOption.code !== DEFAULT_LANGUAGE && !locale.hasTranslation ? " · tarjima kiritilmagan" : ""}
                    </div>

                    <label className="adminField adminFieldWide">
                      <span className="adminFieldLabel">Savol matni</span>
                      <input
                        className="input"
                        value={locale.text}
                        onChange={(event) =>
                          setTicket((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  questions: prev.questions.map((item) =>
                                    item && item.id === question.id
                                      ? updateQuestionLocaleText(item, langOption.code, "text", event.target.value)
                                      : item
                                  )
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
                        value={locale.explanation}
                        onChange={(event) =>
                          setTicket((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  questions: prev.questions.map((item) =>
                                    item && item.id === question.id
                                      ? updateQuestionLocaleText(item, langOption.code, "explanation", event.target.value)
                                      : item
                                  )
                                }
                              : prev
                          )
                        }
                        placeholder="Markdown yozing: **qalin**, *qiya*, - ro‘yxat"
                      />
                    </label>

                    <div className="adminOptionsGrid">
                      {locale.options.map((option, optionIndex) => (
                        <label key={optionIndex} className="adminField">
                          <span className="adminFieldLabel">Variant {optionIndex + 1}</span>
                          <input
                            className="input"
                            value={option}
                            onChange={(event) =>
                              setTicket((prev) =>
                                prev
                                  ? {
                                      ...prev,
                                      questions: prev.questions.map((item) =>
                                        item && item.id === question.id
                                          ? updateQuestionLocaleOption(item, langOption.code, optionIndex, event.target.value)
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

                    <label className="adminField adminFieldWide">
                      <span className="adminFieldLabel">To‘g‘ri javob</span>
                      <select
                        className="input"
                        value={String(locale.correctIndex)}
                        onChange={(event) =>
                          setTicket((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  questions: prev.questions.map((item) =>
                                    item && item.id === question.id
                                      ? updateQuestionLocaleCorrectIndex(item, langOption.code, Number(event.target.value))
                                      : item
                                  )
                                }
                              : prev
                          )
                        }
                      >
                        {locale.options.map((_, optionIndex) => (
                          <option key={optionIndex} value={optionIndex}>
                            {optionIndex + 1}-variant
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                );
              })}
              </article>
            );
          })
        ) : (
          <section className="card adminEmpty adminEmptyCompact">
            <div className="adminEmptyTitle">Savollar yo‘q</div>
            <div className="adminEmptyText">Birinchi savolni qo‘shish uchun yuqoridagi tugmadan foydalaning.</div>
          </section>
        )}
      </div>

      <button className="btn btn-primary adminSaveFloating" type="button" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending || !ticket}>
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
