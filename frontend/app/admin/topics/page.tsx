"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, LayoutGrid, RefreshCw, Save, Trash2, Upload } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { useAuth } from "@/app/auth-provider";
import { jsonOrError } from "@/lib/api-authed";

type TopicForm = {
  id: number | null;
  title: string;
};

type TopicItem = {
  id: number;
  title: string;
  questionCount?: number;
  adminMarked?: boolean;
};

const emptyForm = (): TopicForm => ({
  id: null,
  title: ""
});

function parseTopicPayload(rawText: string) {
  const parsed = JSON.parse(rawText);
  if (Array.isArray(parsed?.topics)) return parsed.topics;
  if (Array.isArray(parsed)) return parsed;
  throw new Error("JSON object ichida topics array yuboring");
}

export default function AdminTopicsPage() {
  const qc = useQueryClient();
  const router = useRouter();
  const { authFetch } = useAuth();
  const [form, setForm] = useState<TopicForm>(() => emptyForm());
  const [importText, setImportText] = useState('{"topics":[]}');
  const titleInputRef = useRef<HTMLInputElement | null>(null);

  const topicsQuery = useQuery({
    queryKey: ["admin-topics"],
    queryFn: async () => {
      const res = await authFetch("/api/admin/topics");
      const data = await jsonOrError(res);
      return Array.isArray(data.topics) ? data.topics : [];
    }
  });

  const selectedTopic = useMemo(
    () => (topicsQuery.data || []).find((topic: TopicItem) => Number(topic.id) === Number(form.id)) || null,
    [topicsQuery.data, form.id]
  );
  const importableTopics = useMemo(
    () => ({ topics: (topicsQuery.data || []).map((topic: TopicItem) => ({ title: topic.title })) }),
    [topicsQuery.data]
  );

  useEffect(() => {
    if (topicsQuery.error) toast.error((topicsQuery.error as any)?.message || "Xatolik");
  }, [topicsQuery.error]);

  useEffect(() => {
    if (!selectedTopic) return;
    setForm({
      id: selectedTopic.id,
      title: selectedTopic.title || ""
    });
  }, [selectedTopic]);

  useEffect(() => {
    if (!form.id) return;
    titleInputRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    titleInputRef.current?.focus();
  }, [form.id]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await authFetch(form.id ? `/api/admin/topics/${encodeURIComponent(String(form.id))}` : "/api/admin/topics", {
        method: form.id ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: form.title })
      });
      return jsonOrError(res);
    },
    onSuccess: async () => {
      toast.success(form.id ? "Mavzu yangilandi" : "Mavzu qo‘shildi");
      setForm(emptyForm());
      await qc.invalidateQueries({ queryKey: ["admin-topics"] });
    },
    onError: (error: any) => toast.error(error?.message || "Xatolik")
  });

  const deleteMutation = useMutation({
    mutationFn: async (topicId: number) => {
      const res = await authFetch(`/api/admin/topics/${encodeURIComponent(String(topicId))}`, { method: "DELETE" });
      return jsonOrError(res);
    },
    onSuccess: async () => {
      toast.success("Mavzu o‘chirildi");
      setForm(emptyForm());
      await qc.invalidateQueries({ queryKey: ["admin-topics"] });
    },
    onError: (error: any) => toast.error(error?.message || "Xatolik")
  });

  const deleteAllMutation = useMutation({
    mutationFn: async () => {
      const res = await authFetch("/api/admin/topics", { method: "DELETE" });
      return jsonOrError(res);
    },
    onSuccess: async (data: any) => {
      const deletedCount = Number(data?.deletedCount || 0);
      toast.success(deletedCount ? `${deletedCount} ta mavzu o‘chirildi` : "Mavzular o‘chirildi");
      setForm(emptyForm());
      await qc.invalidateQueries({ queryKey: ["admin-topics"] });
    },
    onError: (error: any) => toast.error(error?.message || "Xatolik")
  });

  const markMutation = useMutation({
    mutationFn: async ({ topicId, adminMarked }: { topicId: number; adminMarked: boolean }) => {
      const topic = (topicsQuery.data || []).find((item: TopicItem) => Number(item.id) === Number(topicId));
      if (!topic) throw new Error("Mavzu topilmadi");
      const res = await authFetch(`/api/admin/topics/${encodeURIComponent(String(topicId))}/mark`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          adminMarked,
          title: topic.title
        })
      });
      return jsonOrError(res);
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["admin-topics"] });
    },
    onError: (error: any) => toast.error(error?.message || "Xatolik")
  });

  const importMutation = useMutation({
    mutationFn: async () => {
      const payload = parseTopicPayload(importText);
      const res = await authFetch("/api/admin/topics/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ topics: payload })
      });
      return jsonOrError(res);
    },
    onSuccess: async () => {
      toast.success("Mavzular import qilindi");
      await qc.invalidateQueries({ queryKey: ["admin-topics"] });
    },
    onError: (error: any) => toast.error(error?.message || "Xatolik")
  });

  return (
    <section className="adminSectionPage">
      <div className="adminSectionHeader">
        <button className="btn btn-ghost" type="button" onClick={() => qc.invalidateQueries({ queryKey: ["admin-topics"] })}>
          <RefreshCw className="lucide" aria-hidden="true" /> Yangilash
        </button>
        <button
          className="btn btn-danger"
          type="button"
          onClick={() => {
            const count = topicsQuery.data?.length || 0;
            if (!count) return toast("O‘chirish uchun mavzu yo‘q");
            if (!window.confirm(`Barcha ${count} ta mavzuni o‘chirishni tasdiqlaysizmi? Bu qaytarilmaydi.`)) return;
            deleteAllMutation.mutate();
          }}
          disabled={deleteAllMutation.isPending || !topicsQuery.data?.length}
        >
          <Trash2 className="lucide" aria-hidden="true" /> Hammasini o‘chirish
        </button>
      </div>

      <div className="card adminPanelCard">
        <div className="adminPanelCardHead">
          <div className="adminPanelCardTitle">
            <LayoutGrid className="lucide" aria-hidden="true" /> Mavzu qo‘shish / tahrirlash
          </div>
        </div>

        <form
          className="adminTopicForm"
          onSubmit={(event) => {
            event.preventDefault();
            saveMutation.mutate();
          }}
        >
          <input
            ref={titleInputRef}
            className="input"
            placeholder="Mavzu nomi"
            value={form.title}
            onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
          />

          <div className="adminOptionsToolbar">
            <button className="btn btn-primary" type="submit" disabled={saveMutation.isPending || !form.title.trim()}>
              <Save className="lucide" aria-hidden="true" /> Saqlash
            </button>
            <button className="btn btn-ghost" type="button" onClick={() => setForm(emptyForm())}>
              Yangi mavzu
            </button>
          </div>
        </form>
      </div>

      <div className="card adminPanelCard">
        <div className="adminPanelCardHead">
          <div className="adminPanelCardTitle">
            <Upload className="lucide" aria-hidden="true" /> JSON import
          </div>
        </div>

        <textarea
          className="input adminTextarea"
          value={importText}
          onChange={(event) => setImportText(event.target.value)}
          placeholder='{"topics":[{"title":"Umumiy qoidalar"},{"title":"Haydovchilarning umumiy vazifalari"}]}'
        />

        <div className="adminOptionsToolbar">
          <button className="btn btn-primary" type="button" onClick={() => importMutation.mutate()} disabled={importMutation.isPending}>
            <Upload className="lucide" aria-hidden="true" /> Import qilish
          </button>
          <button
            className="btn btn-ghost"
            type="button"
            onClick={() => setImportText(JSON.stringify(importableTopics, null, 2))}
          >
            Hozirgi JSON ni olish
          </button>
        </div>
      </div>

      <div className="adminTopicsGrid">
        {(topicsQuery.data || []).map((topic: TopicItem, index: number) => (
          <article
            key={topic.id}
            className={`card adminTopicCard ${form.id === topic.id ? "active" : ""} ${topic.adminMarked ? "isMarked" : ""}`}
            role="button"
            tabIndex={0}
            onClick={() => router.push(`/admin/topics/${topic.id}`)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") router.push(`/admin/topics/${topic.id}`);
            }}
          >
            <div className="adminTopicBody">
              <button
                className={`adminTopicCheck ${topic.adminMarked ? "active" : ""}`}
                type="button"
                tabIndex={-1}
                aria-label={topic.adminMarked ? "Tegishli mavzu belgilangan" : "Tegishli mavzu belgilanmagan"}
                aria-pressed={Boolean(topic.adminMarked)}
                onClick={(event) => {
                  event.stopPropagation();
                  markMutation.mutate({ topicId: topic.id, adminMarked: !topic.adminMarked });
                }}
              >
                <Check className="lucide" aria-hidden="true" />
              </button>
              <div className="adminTopicTop">
                <div>
                  <Link href={`/admin/topics/${topic.id}`} className="adminTopicTitleLink">
                    <div className="adminTopicTitle">{topic.title}</div>
                  </Link>
                </div>
              </div>
              <div className="adminTopicMeta">
                <span className="adminTopicMetaBadge">{Number(topic.questionCount || 0)} ta savol</span>
                {topic.adminMarked ? <span className="adminTopicMetaBadge adminTopicMetaBadgeMarked">Belgilangan</span> : null}
              </div>
            </div>
            <span className="adminTopicIndex" aria-hidden="true">
              {String(index + 1).padStart(2, "0")}
            </span>
            <div className="adminTopicActions">
              <button
                className="btn btn-sm adminIconBtn adminIconBtnEdit"
                type="button"
                aria-label="Tahrirlash"
                title="Tahrirlash"
                onClick={(event) => {
                  event.stopPropagation();
                  setForm({
                    id: topic.id,
                    title: topic.title
                  });
                }}
              >
                <Save className="lucide" aria-hidden="true" />
              </button>
              <button
                className="btn btn-sm adminIconBtn adminIconBtnDelete"
                type="button"
                aria-label="O‘chirish"
                title="O‘chirish"
                onClick={(event) => {
                  event.stopPropagation();
                  if (!window.confirm("Mavzuni o‘chirishni tasdiqlaysizmi?")) return;
                  deleteMutation.mutate(topic.id);
                }}
                disabled={deleteMutation.isPending}
              >
                <Trash2 className="lucide" aria-hidden="true" />
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
