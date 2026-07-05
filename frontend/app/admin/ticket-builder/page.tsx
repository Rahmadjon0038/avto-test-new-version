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
  questions: BuilderQuestion[];
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
  return {
    id: String(ticket.id || ""),
    title: String(ticket.title || ""),
    ticketNumber: Number(ticket.ticketNumber || 0),
    status: String(ticket.status || "DRAFT"),
    questions: Array.isArray(ticket.questions) ? ticket.questions.map(cloneQuestion) : []
  };
}

function normalizeQuestionList(items: BuilderQuestion[]) {
  return items.map((item, index) => ({
    ...cloneQuestion(item),
    order: index + 1
  }));
}

function insertAt<T>(items: T[], index: number, item: T) {
  const next = [...items];
  const safeIndex = Math.max(0, Math.min(index, next.length));
  next.splice(safeIndex, 0, item);
  return next;
}

function moveItem<T>(items: T[], fromIndex: number, toIndex: number) {
  const next = [...items];
  const [item] = next.splice(fromIndex, 1);
  if (item === undefined) return next;
  next.splice(Math.max(0, Math.min(toIndex, next.length)), 0, item);
  return next;
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
  const draftQuestions = useMemo(() => normalizeQuestionList(draft?.questions || []), [draft]);
  const draftQuestionIds = useMemo(() => new Set(draftQuestions.map((item) => item.questionId)), [draftQuestions]);
  const visiblePoolQuestions = useMemo(() => poolQuestions.filter((question) => !draftQuestionIds.has(question.questionId)), [poolQuestions, draftQuestionIds]);
  const totalUnassigned = questionsQuery.data?.pages?.[0]?.total ?? visiblePoolQuestions.length;
  const isDraftReady = draftQuestions.length === 20;

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
    mutationFn: async (questionIds: string[]) => {
      const res = await authFetch("/api/admin/ticket-builder/reorder", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ questionIds })
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
        if (draftQuestions.length >= 20) {
          toast.error("Bitta biletga faqat 20 ta savol qo‘shiladi");
          return;
        }
        if (draftQuestionIds.has(payload.questionId)) return;
        const sourceQuestion = visiblePoolQuestions.find((item) => item.questionId === payload.questionId);
        if (!sourceQuestion) return;
        const optimistic = insertAt(draftQuestions, slotIndex, sourceQuestion).slice(0, 20);
        setDraft({ ...draft, questions: normalizeQuestionList(optimistic) });
        await addMutation.mutateAsync({ questionId: payload.questionId, order: slotIndex + 1 }).catch(() => {
          void qc.invalidateQueries({ queryKey: ["admin-ticket-builder-draft"] });
          void qc.invalidateQueries({ queryKey: ["admin-ticket-builder-questions"] });
        });
        return;
      }

      const fromIndex = Number(payload.fromIndex ?? -1);
      if (!Number.isFinite(fromIndex) || fromIndex < 0 || fromIndex >= draftQuestions.length) return;
      if (fromIndex === slotIndex) return;
      const nextQuestions = moveItem(draftQuestions, fromIndex, slotIndex).slice(0, 20);
      setDraft({ ...draft, questions: normalizeQuestionList(nextQuestions) });
      await reorderMutation.mutateAsync(nextQuestions.map((item) => item.questionId)).catch(() => {
        void qc.invalidateQueries({ queryKey: ["admin-ticket-builder-draft"] });
        void qc.invalidateQueries({ queryKey: ["admin-ticket-builder-questions"] });
      });
    };
  }

  function onDragStartPool(question: BuilderQuestion) {
    return (event: DragEvent<HTMLElement>) => {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("application/json", JSON.stringify({ source: "pool", questionId: question.questionId }));
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
            disabled={!isDraftReady || completeMutation.isPending}
            onClick={() => {
              if (!isDraftReady) return toast.error("Saqlash uchun 20 ta savol kerak");
              if (!window.confirm(`Ushbu biletni yakunlaysizmi? ${draftQuestions.length}/20 savol tayyor.`)) return;
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
              <span className="badge">{draftQuestions.length}/20 savol</span>
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
                          onClick={() => removeMutation.mutate(question.questionId)}
                          disabled={removeMutation.isPending}
                        >
                          <Trash2 className="lucide" aria-hidden="true" />
                        </button>
                      </div>
                      <div className="ticketBuilderQuestionText">{question.text || "Savol matni yo‘q"}</div>
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
            <div className="ticketBuilderProgress">{draftQuestions.length}/20 savol</div>
            <button
              className="btn btn-primary"
              type="button"
              disabled={!isDraftReady || completeMutation.isPending}
              onClick={() => {
                if (!isDraftReady) return;
                if (!window.confirm(`Ushbu biletni yakunlaysizmi? ${draftQuestions.length}/20 savol tayyor.`)) return;
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
                  <div className="ticketBuilderPoolText">{question.text || "Savol matni yo‘q"}</div>
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
