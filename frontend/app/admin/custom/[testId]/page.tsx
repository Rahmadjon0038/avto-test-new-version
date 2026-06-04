"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Pencil, Plus, Save, Trash2 } from "lucide-react";
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
  const params = useParams<{ testId: string }>();
  const testId = String(params.testId || "");
  const qc = useQueryClient();
  const { authFetch } = useAuth();
  const [topic, setTopic] = useState<AdminTopic | null>(null);
  const [imageDrafts, setImageDrafts] = useState<Record<string, ImageDraft>>({});
  const objectUrlsRef = useRef<Record<string, string>>({});
  const [zoomedImage, setZoomedImage] = useState<string | null>(null);

  const customTestQuery = useQuery({
    queryKey: ["admin-custom-test", testId],
    queryFn: async () => {
      const res = await authFetch(`/api/admin/custom-tests/${encodeURIComponent(testId)}`);
      const data = (await jsonOrError(res)) as { customTest: AdminTopic };
      return data.customTest;
    },
    enabled: Boolean(testId)
  });

  useEffect(() => {
    if (customTestQuery.data) {
      setTopic({
        id: String(customTestQuery.data.id),
        title: String(customTestQuery.data.title || ""),
        questions: Array.isArray(customTestQuery.data.questions) ? customTestQuery.data.questions.map(cloneQuestion) : []
      });
    }
  }, [customTestQuery.data]);

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
    if (customTestQuery.error) toast.error((customTestQuery.error as any)?.message || "Xatolik");
  }, [customTestQuery.error]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!topic) throw new Error("Test topilmadi");
      const normalizedQuestions = topic.questions.map(normalizeQuestionForSave);
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
      const res = await authFetch(`/api/admin/custom-tests/${encodeURIComponent(testId)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: topic.title,
          questions: normalizedQuestions
        })
      });
      return (await jsonOrError(res)) as { customTest: AdminTopic };
    },
    onSuccess: async (data) => {
      setTopic({
        id: String(data.customTest.id),
        title: String(data.customTest.title || ""),
        questions: Array.isArray(data.customTest.questions) ? data.customTest.questions.map(cloneQuestion) : []
      });
      await qc.invalidateQueries({ queryKey: ["admin-custom-tests"] });
      await qc.invalidateQueries({ queryKey: ["admin-custom-test", testId] });
      toast.success("Saqlandi");
    },
    onError: (error: any) => toast.error(error?.message || "Xatolik")
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const res = await authFetch(`/api/admin/custom-tests/${encodeURIComponent(testId)}`, {
        method: "DELETE"
      });
      return jsonOrError(res);
    },
    onSuccess: async () => {
      toast.success("Test o‘chirildi");
      await qc.invalidateQueries({ queryKey: ["admin-custom-tests"] });
      router.push("/admin/custom");
    },
    onError: (error: any) => toast.error(error?.message || "Xatolik")
  });

  const questionCount = useMemo(() => topic?.questions?.length || 0, [topic]);

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
        customTestId: testId,
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
        customTestId: testId,
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

  if (!topic && !customTestQuery.isLoading) {
    return (
      <section className="adminEmpty card">
        <div className="adminEmptyTitle">Test topilmadi</div>
        <div className="adminEmptyText">Tanlangan test mavjud emas.</div>
        <button className="btn btn-primary" type="button" onClick={() => router.push("/admin/custom")}>
          <ArrowLeft className="lucide" aria-hidden="true" /> Ro‘yxatga qaytish
        </button>
      </section>
    );
  }

  return (
    <section className="adminSectionPage">
      <div className="adminSectionHeader">
        <div className="adminTopicActions">
          <button className="btn btn-ghost" type="button" onClick={() => router.push("/admin/custom")}>
            <ArrowLeft className="lucide" aria-hidden="true" /> Orqaga
          </button>
          <button className="btn btn-danger" type="button" onClick={() => deleteMutation.mutate()} disabled={deleteMutation.isPending}>
            <Trash2 className="lucide" aria-hidden="true" /> O‘chirish
          </button>
        </div>
      </div>

      <div className="card adminPanelCard">
        <div className="adminPanelCardHead">
          <div className="adminPanelCardTitle">Test ma’lumoti</div>
        </div>

        <div className="adminFieldGroup">
          <label className="adminField">
            <span className="adminFieldLabel">Test nomi</span>
            <input
              className="input"
              value={topic?.title || ""}
              onChange={(event) => setTopic((prev) => (prev ? { ...prev, title: event.target.value } : prev))}
              placeholder="Masalan: 20 ta"
            />
          </label>
        </div>
      </div>

      <div className="adminQuestionsHeader">
        <div className="adminPanelCardTitle">Savollar</div>
        <button className="btn btn-primary" type="button" onClick={() => setTopic((prev) => (prev ? { ...prev, questions: [...prev.questions, createEmptyQuestion(prev.questions.length + 1)] } : prev))}>
          <Plus className="lucide" aria-hidden="true" /> Savol qo‘shish
        </button>
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
                  onClick={() =>
                    setTopic((prev) =>
                      prev
                        ? {
                            ...prev,
                            questions: prev.questions.filter((item) => item.id !== question.id)
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

      <button className="btn btn-primary adminSaveFloating" type="button" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending || !topic}>
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
