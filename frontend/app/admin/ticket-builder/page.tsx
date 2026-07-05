"use client";

import { useEffect, useMemo, useState, type DragEvent } from "react";
import { ArrowLeft, GripVertical, RefreshCw, Save, Search, Trash2 } from "lucide-react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { useRouter } from "next/navigation";
import { useAuth } from "@/app/auth-provider";
import { jsonOrError } from "@/lib/api-authed";

type BuilderQuestion = {
  id: string;
  questionId: string;
  order?: number;
  topicId: number;
  topicSlug: string;
  topicTitle: string;
  questionIndex: number;
  text: string;
  image: string;
  audio?: string;
  options: string[];
  correctIndex: number;
  explanation: string;
};

type DraftTicket = {
  id: string;
  title: string;
  ticketNumber: number;
  status: "DRAFT" | "COMPLETED" | string;
  questions: Array<BuilderQuestion | null>;
};

type QuestionsPage = {
  questions: BuilderQuestion[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
};

function cloneQuestion(question: BuilderQuestion): BuilderQuestion {
  return {
    id: String(question.id || question.questionId || ""),
    questionId: String(question.questionId || question.id || ""),
    order: Number(question.order || 0),
    topicId: Number(question.topicId || 0),
    topicSlug: String(question.topicSlug || ""),
    topicTitle: String(question.topicTitle || ""),
    questionIndex: Number(question.questionIndex || 0),
    text: String(question.text || ""),
    image: String(question.image || ""),
    audio: String(question.audio || ""),
    options: Array.isArray(question.options) ? question.options.map((option) => String(option || "")) : [],
    correctIndex: Number.isFinite(Number(question.correctIndex)) ? Number(question.correctIndex) : 0,
    explanation: String(question.explanation || "")
  };
}

function cloneDraft(ticket: DraftTicket): DraftTicket {
  const rawQuestions = Array.isArray(ticket.questions) ? ticket.questions : [];
  const slots: Array<BuilderQuestion | null> = Array.from({ length: 20 }, (_, index) => {
    const question = rawQuestions[index] || null;
    return question ? cloneQuestion(question) : null;
  });
  return {
    id: String(ticket.id || ""),
    title: String(ticket.title || ""),
    ticketNumber: Number(ticket.ticketNumber || 0),
    status: String(ticket.status || "DRAFT"),
    questions: slots
  };
}

function normalizeDraftSlots(items: Array<BuilderQuestion | null>) {
  return Array.from({ length: 20 }, (_, index) => {
    const item = items[index] || null;
    if (!item) return null;
    return {
      ...cloneQuestion(item),
      order: index + 1
    };
  });
}

function setCompactDragImage(event: DragEvent<HTMLElement>) {
  const source = event.currentTarget as HTMLElement | null;
  if (!source) return;
  const clone = source.cloneNode(true) as HTMLElement;
  clone.style.position = "absolute";
  clone.style.top = "-1000px";
  clone.style.left = "-1000px";
  clone.style.width = `${Math.max(240, source.clientWidth)}px`;
  clone.style.pointerEvents = "none";
  clone.style.transform = "scale(0.9)";
  clone.style.transformOrigin = "top left";
  clone.style.opacity = "0.92";
  clone.style.boxSizing = "border-box";
  document.body.appendChild(clone);
  event.dataTransfer.setDragImage(clone, Math.min(source.clientWidth / 2, 120), Math.min(source.clientHeight / 2, 60));
  window.setTimeout(() => {
    clone.remove();
  }, 0);
}

function resolveQuestionImage(image?: string) {
  const value = String(image || "").trim();
  if (!value) return "";
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

function optionLabel(index: number) {
  return String.fromCharCode(65 + index);
}

export default function AdminTicketBuilderPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const { authFetch } = useAuth();
  const [draft, setDraft] = useState<DraftTicket | null>(null);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [dragData, setDragData] = useState<{ source: "pool" | "draft"; questionId: string; fromIndex?: number } | null>(null);
  const pageSize = 40;

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(search.trim());
    }, 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  const draftQuery = useQuery({
    queryKey: ["admin-ticket-builder-draft"],
    queryFn: async () => {
      const res = await authFetch("/api/admin/ticket-builder/draft");
      const data = await jsonOrError(res);
      return data.ticket as DraftTicket;
    }
  });

  useEffect(() => {
    if (draftQuery.data) setDraft(cloneDraft(draftQuery.data));
  }, [draftQuery.data]);

  useEffect(() => {
    if (draftQuery.error) toast.error((draftQuery.error as any)?.message || "Xatolik");
  }, [draftQuery.error]);

  const questionsQuery = useInfiniteQuery({
    queryKey: ["admin-ticket-builder-questions", debouncedSearch],
    initialPageParam: 1,
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams({
        page: String(pageParam || 1),
        limit: String(pageSize),
        search: debouncedSearch
      });
      const res = await authFetch(`/api/admin/ticket-builder/questions?${params.toString()}`);
      const data = await jsonOrError(res);
      return {
        questions: Array.isArray(data.questions) ? (data.questions as BuilderQuestion[]) : [],
        total: Number(data.total || 0),
        page: Number(data.page || 1),
        limit: Number(data.limit || pageSize),
        hasMore: Boolean(data.hasMore)
      } as QuestionsPage;
    },
    getNextPageParam: (lastPage) => (lastPage.hasMore ? lastPage.page + 1 : undefined)
  });

  useEffect(() => {
    if (questionsQuery.error) toast.error((questionsQuery.error as any)?.message || "Xatolik");
  }, [questionsQuery.error]);

  const poolQuestions = useMemo(() => (questionsQuery.data?.pages || []).flatMap((page) => page.questions).map(cloneQuestion), [questionsQuery.data]);
  const draftQuestions = useMemo(() => normalizeDraftSlots(draft?.questions || []), [draft]);
  const draftQuestionIds = useMemo(
    () => new Set(draftQuestions.filter(Boolean).map((item) => String(item?.questionId || ""))),
    [draftQuestions]
  );
  const visiblePoolQuestions = useMemo(() => poolQuestions.filter((question) => !draftQuestionIds.has(question.questionId)), [poolQuestions, draftQuestionIds]);
  const totalUnassigned = questionsQuery.data?.pages?.[0]?.total ?? visiblePoolQuestions.length;
  const filledDraftCount = useMemo(() => draftQuestions.filter(Boolean).length, [draftQuestions]);
  const canSaveDraft = filledDraftCount > 0;

  const addMutation = useMutation({
    mutationFn: async ({ questionId, order }: { questionId: string; order: number }) => {
      const res = await authFetch("/api/admin/ticket-builder/add-question", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ questionId, order })
      });
      return jsonOrError(res);
    },
    onSuccess: async (data: any) => {
      if (data?.ticket) setDraft(cloneDraft(data.ticket));
      await qc.invalidateQueries({ queryKey: ["admin-ticket-builder-draft"] });
      await qc.invalidateQueries({ queryKey: ["admin-ticket-builder-questions"] });
    },
    onError: (error: any) => toast.error(error?.message || "Xatolik")
  });

  const removeMutation = useMutation({
    mutationFn: async (questionId: string) => {
      const res = await authFetch("/api/admin/ticket-builder/remove-question", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ questionId })
      });
      return jsonOrError(res);
    },
    onSuccess: async (data: any) => {
      if (data?.ticket) setDraft(cloneDraft(data.ticket));
      await qc.invalidateQueries({ queryKey: ["admin-ticket-builder-draft"] });
      await qc.invalidateQueries({ queryKey: ["admin-ticket-builder-questions"] });
    },
    onError: (error: any) => toast.error(error?.message || "Xatolik")
  });

  const reorderMutation = useMutation({
    mutationFn: async ({ questionId, fromOrder, toOrder }: { questionId: string; fromOrder: number; toOrder: number }) => {
      const res = await authFetch("/api/admin/ticket-builder/reorder", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ questionId, fromOrder, toOrder })
      });
      return jsonOrError(res);
    },
    onSuccess: async (data: any) => {
      if (data?.ticket) setDraft(cloneDraft(data.ticket));
      await qc.invalidateQueries({ queryKey: ["admin-ticket-builder-draft"] });
      await qc.invalidateQueries({ queryKey: ["admin-ticket-builder-questions"] });
    },
    onError: (error: any) => toast.error(error?.message || "Xatolik")
  });

  const completeMutation = useMutation({
    mutationFn: async () => {
      const res = await authFetch("/api/admin/ticket-builder/complete", {
        method: "POST"
      });
      return jsonOrError(res);
    },
    onSuccess: async (data: any) => {
      toast.success("Bilet yakunlandi");
      if (data?.draft) setDraft(cloneDraft(data.draft));
      await qc.invalidateQueries({ queryKey: ["admin-ticket-builder-draft"] });
      await qc.invalidateQueries({ queryKey: ["admin-ticket-builder-questions"] });
    },
    onError: (error: any) => toast.error(error?.message || "Xatolik")
  });

  function handleDropOnSlot(slotIndex: number) {
    return async (event: DragEvent<HTMLElement>) => {
      event.preventDefault();
      const raw = event.dataTransfer.getData("application/json");
      if (!raw) return;
      let payload: { source: "pool" | "draft"; questionId: string; fromIndex?: number } | null = null;
      try {
        payload = JSON.parse(raw);
      } catch {
        return;
      }
      if (!payload?.questionId || !draft) return;

      if (payload.source === "pool") {
        const occupiedQuestion = draftQuestions[slotIndex] || null;
        if (occupiedQuestion) {
          toast.error("Bu katakcha band. Avval savolni remove qiling.");
          return;
        }
        if (filledDraftCount >= 20) {
          toast.error("Bitta biletga faqat 20 ta savol qo‘shiladi");
          return;
        }
        if (draftQuestionIds.has(payload.questionId)) return;
        const sourceQuestion = visiblePoolQuestions.find((item) => item.questionId === payload.questionId);
        if (!sourceQuestion) return;
        const optimistic = [...draftQuestions];
        optimistic[slotIndex] = { ...sourceQuestion, order: slotIndex + 1 };
        setDraft({ ...draft, questions: optimistic });
        await addMutation.mutateAsync({ questionId: payload.questionId, order: slotIndex + 1 }).catch(() => {
          void qc.invalidateQueries({ queryKey: ["admin-ticket-builder-draft"] });
          void qc.invalidateQueries({ queryKey: ["admin-ticket-builder-questions"] });
        });
        return;
      }

      const fromIndex = Number(payload.fromIndex ?? -1);
      if (!Number.isFinite(fromIndex) || fromIndex < 0 || fromIndex >= draftQuestions.length) return;
      if (fromIndex === slotIndex) return;
      const nextQuestions = [...draftQuestions];
      const sourceQuestion = nextQuestions[fromIndex];
      if (!sourceQuestion) return;
      const targetQuestion = nextQuestions[slotIndex] || null;
      nextQuestions[fromIndex] = null;
      nextQuestions[slotIndex] = { ...sourceQuestion, order: slotIndex + 1 };
      if (targetQuestion) {
        nextQuestions[fromIndex] = { ...targetQuestion, order: fromIndex + 1 };
      }
      setDraft({ ...draft, questions: nextQuestions });
      await reorderMutation
        .mutateAsync({
          questionId: sourceQuestion.questionId,
          fromOrder: fromIndex + 1,
          toOrder: slotIndex + 1
        })
        .catch(() => {
          void qc.invalidateQueries({ queryKey: ["admin-ticket-builder-draft"] });
          void qc.invalidateQueries({ queryKey: ["admin-ticket-builder-questions"] });
        });
    };
  }

  function onDragStartPool(question: BuilderQuestion) {
    return (event: DragEvent<HTMLElement>) => {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("application/json", JSON.stringify({ source: "pool", questionId: question.questionId }));
      setCompactDragImage(event);
      setDragData({ source: "pool", questionId: question.questionId });
    };
  }

  function onDragStartDraft(question: BuilderQuestion, index: number) {
    return (event: DragEvent<HTMLElement>) => {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData(
        "application/json",
        JSON.stringify({ source: "draft", questionId: question.questionId, fromIndex: index })
      );
      setCompactDragImage(event);
      setDragData({ source: "draft", questionId: question.questionId, fromIndex: index });
    };
  }

  return (
    <section className="adminSectionPage ticketBuilderPage">
      <div className="adminSectionHeader">
        <button className="btn btn-ghost" type="button" onClick={() => router.push("/admin")}>
          <ArrowLeft className="lucide" aria-hidden="true" /> Orqaga
        </button>
        <div className="adminTopicActions">
          <button className="btn btn-ghost" type="button" onClick={() => draftQuery.refetch()} disabled={draftQuery.isFetching}>
            <RefreshCw className="lucide" aria-hidden="true" /> Draftni yangilash
          </button>
          <button
            className="btn btn-primary"
            type="button"
            disabled={!canSaveDraft || completeMutation.isPending}
            onClick={() => {
              if (!canSaveDraft) return toast.error("Kamida bitta savol kerak");
              if (
                !window.confirm(
                  filledDraftCount < 20
                    ? `Biletni bo‘sh slotlar bilan saqlaysizmi? Hozir ${filledDraftCount}/20 savol to‘ldirilgan.`
                    : `Ushbu biletni yakunlaysizmi? ${filledDraftCount}/20 savol tayyor.`
                )
              )
                return;
              completeMutation.mutate();
            }}
          >
            <Save className="lucide" aria-hidden="true" /> Saqlash
          </button>
        </div>
      </div>

      <div className="ticketBuilderLayout">
        <aside className="card ticketBuilderPanel ticketBuilderDraftPanel">
          <div className="ticketBuilderPanelHead">
            <div>
              <div className="ticketBuilderTitle">{draft?.title || "Bilet №1"}</div>
              <div className="adminPanelCardDesc">Savollarni chap tarafdagi 20 slotga drag qilib joylang.</div>
            </div>
            <div className="ticketBuilderMeta">
              <span className="badge">{filledDraftCount}/20 savol</span>
              <span className="badge">{draft?.status || "DRAFT"}</span>
            </div>
          </div>

          <div className="ticketBuilderSlots">
            {Array.from({ length: 20 }).map((_, index) => {
              const question = draftQuestions[index] || null;
              return (
                <div
                  key={index}
                  className={`ticketBuilderSlot ${question ? "filled" : "empty"}`}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={handleDropOnSlot(index)}
                >
                  <div className="ticketBuilderSlotIndex">{index + 1}</div>
                  {question ? (
                    <article
                      className={`card ticketBuilderQuestionCard ${dragData?.questionId === question.questionId ? "dragging" : ""}`}
                      draggable
                      onDragStart={onDragStartDraft(question, index)}
                      onDragEnd={() => setDragData(null)}
                    >
                      <div className="ticketBuilderQuestionCardHead">
                        <GripVertical className="lucide ticketBuilderGrip" aria-hidden="true" />
                        <div className="ticketBuilderQuestionBadge">{question.topicTitle || "Mavzu"}</div>
                        <button
                          className="btn btn-sm adminIconBtn adminIconBtnDelete"
                          type="button"
                          title="Remove"
                          aria-label="Remove"
                          onClick={() => {
                            const nextQuestions = [...draftQuestions];
                            nextQuestions[index] = null;
                            if (draft) setDraft({ ...draft, questions: nextQuestions });
                            removeMutation.mutate(question.questionId);
                          }}
                          disabled={removeMutation.isPending}
                        >
                          <Trash2 className="lucide" aria-hidden="true" />
                        </button>
                      </div>
                      {resolveQuestionImage(question.image) ? (
                        <div className="ticketBuilderPreviewWrap ticketBuilderPreviewWrapCompact">
                          <img className="ticketBuilderPreviewImg" src={resolveQuestionImage(question.image)} alt={question.text || "Savol rasmi"} loading="lazy" />
                        </div>
                      ) : null}
                      <div className="ticketBuilderQuestionText">{question.text || "Savol matni yo‘q"}</div>
                      {Array.isArray(question.options) && question.options.length ? (
                        <div className="ticketBuilderOptionList ticketBuilderOptionListCompact">
                          {question.options.map((option, optionIndex) => (
                            <div key={`${question.questionId}-draft-${optionIndex}`} className="ticketBuilderOptionItem">
                              <span className="ticketBuilderOptionKey">{optionLabel(optionIndex)}</span>
                              <span className="ticketBuilderOptionText">{option || "Bo‘sh variant"}</span>
                            </div>
                          ))}
                        </div>
                      ) : null}
                      <div className="ticketBuilderQuestionMeta">
                        <span className="badge">ID: {question.questionId}</span>
                        <span className="badge">{Array.isArray(question.options) ? question.options.length : 0} variant</span>
                      </div>
                    </article>
                  ) : (
                    <div className="ticketBuilderSlotEmpty">Slot {index + 1}</div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="ticketBuilderFooter">
            <div className="ticketBuilderProgress">{filledDraftCount}/20 savol</div>
            <button
              className="btn btn-primary"
              type="button"
              disabled={!canSaveDraft || completeMutation.isPending}
              onClick={() => {
                if (!canSaveDraft) return;
                if (
                  !window.confirm(
                    filledDraftCount < 20
                      ? `Biletni bo‘sh slotlar bilan saqlaysizmi? Hozir ${filledDraftCount}/20 savol to‘ldirilgan.`
                      : `Ushbu biletni yakunlaysizmi? ${filledDraftCount}/20 savol tayyor.`
                  )
                )
                  return;
                completeMutation.mutate();
              }}
            >
              <Save className="lucide" aria-hidden="true" /> Saqlash
            </button>
          </div>
        </aside>

        <main className="card ticketBuilderPanel ticketBuilderPoolPanel">
          <div className="ticketBuilderPanelHead">
            <div>
              <div className="ticketBuilderTitle">Biriktirilmagan savollar</div>
              <div className="adminPanelCardDesc">{totalUnassigned} ta qoldi</div>
            </div>
            <div className="adminSearchWrap ticketBuilderSearchWrap">
              <Search className="lucide adminSearchIcon" aria-hidden="true" />
              <input
                className="input adminSearchInput ticketBuilderSearchInput"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Savol matni bo‘yicha qidiring"
              />
            </div>
          </div>

          <div className="ticketBuilderPoolGrid">
            {visiblePoolQuestions.length ? (
              visiblePoolQuestions.map((question) => (
                <article
                  key={question.questionId}
                  className="card ticketBuilderPoolItem"
                  draggable
                  onDragStart={onDragStartPool(question)}
                  onDragEnd={() => setDragData(null)}
                >
                  <div className="ticketBuilderPoolHead">
                    <span className="badge">ID: {question.questionId}</span>
                    <span className="badge">{Array.isArray(question.options) ? question.options.length : 0} variant</span>
                  </div>
                  {resolveQuestionImage(question.image) ? (
                    <div className="ticketBuilderPreviewWrap ticketBuilderPreviewWrapSmall">
                      <img className="ticketBuilderPreviewImg" src={resolveQuestionImage(question.image)} alt={question.text || "Savol rasmi"} loading="lazy" />
                    </div>
                  ) : null}
                  <div className="ticketBuilderPoolText">{question.text || "Savol matni yo‘q"}</div>
                  {Array.isArray(question.options) && question.options.length ? (
                    <div className="ticketBuilderOptionList">
                      {question.options.map((option, optionIndex) => (
                        <div key={`${question.questionId}-${optionIndex}`} className="ticketBuilderOptionItem">
                          <span className="ticketBuilderOptionKey">{optionLabel(optionIndex)}</span>
                          <span className="ticketBuilderOptionText">{option || "Bo‘sh variant"}</span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  <div className="ticketBuilderPoolMeta">
                    <span className="ticketBuilderPoolTopic">{question.topicTitle || "Kategoriya yo‘q"}</span>
                  </div>
                </article>
              ))
            ) : (
              <section className="adminEmpty card">
                <div className="adminEmptyTitle">Savol topilmadi</div>
                <div className="adminEmptyText">Search natijasiga mos yoki biriktirilmagan savol yo‘q.</div>
              </section>
            )}
          </div>

          <div className="ticketBuilderLoadMoreRow">
            <div className="adminSectionSub">{questionsQuery.isFetching ? "Yangilanmoqda..." : `${visiblePoolQuestions.length} / ${totalUnassigned} ko‘rsatildi`}</div>
            {questionsQuery.hasNextPage ? (
              <button className="btn btn-ghost" type="button" onClick={() => questionsQuery.fetchNextPage()} disabled={questionsQuery.isFetchingNextPage}>
                <RefreshCw className="lucide" aria-hidden="true" /> Ko‘proq yuklash
              </button>
            ) : null}
          </div>
        </main>
      </div>
    </section>
  );
}
