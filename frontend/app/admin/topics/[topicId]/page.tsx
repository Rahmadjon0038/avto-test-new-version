"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Pencil, Plus, Save, Trash2, Upload } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { useAuth } from "@/app/auth-provider";
import { jsonOrError } from "@/lib/api-authed";

type Question = {
  id: string;
  image: string;
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

function createEmptyQuestion(seed: number): Question {
  return {
    id: `q-${Date.now()}-${seed}`,
    image: "",
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

export default function AdminTopicDetailPage() {
  const router = useRouter();
  const params = useParams<{ topicId: string }>();
  const topicId = String(params.topicId || "");
  const qc = useQueryClient();
  const { authFetch } = useAuth();
  const [topic, setTopic] = useState<AdminTopic | null>(null);
  const [importText, setImportText] = useState("[]");
  const [imageDrafts, setImageDrafts] = useState<Record<string, ImageDraft>>({});
  const objectUrlsRef = useRef<Record<string, string>>({});
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
            JSON ichiga savollar massivi yuboring. Har bir savolda text, options, correctIndex, explanation va image bo‘lishi mumkin.
            id yubormang, backend uni avtomatik yaratadi.
          </div>
          <textarea
            className="input adminTextarea"
            rows={9}
            value={importText}
            onChange={(event) => setImportText(event.target.value)}
            placeholder={`[\n  {\n    "correctIndex": 1,\n    "explanation": "",\n    "image": "",\n    "options": ["Variant 1", "Variant 2"],\n    "text": "Savol matni"\n  }\n]`}
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
