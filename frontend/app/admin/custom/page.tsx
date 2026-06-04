"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LayoutGrid, RefreshCw, Save, Trash2, Upload } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { useAuth } from "@/app/auth-provider";
import { jsonOrError } from "@/lib/api-authed";

type CustomTestForm = {
  id: number | null;
  title: string;
};

type CustomTestItem = {
  id: number;
  title: string;
};

const emptyForm = (): CustomTestForm => ({
  id: null,
  title: ""
});

function parseCustomTestPayload(rawText: string) {
  let parsed: any;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new Error("JSON noto‘g‘ri formatda. Masalan: { \"customTests\": [ { \"title\": \"20 ta\" } ] }");
  }

  if (Array.isArray(parsed?.customTests)) return parsed.customTests;
  if (Array.isArray(parsed)) return parsed;
  throw new Error("JSON ichida `customTests` massivi bo‘lishi kerak");
}

export default function AdminCustomTestsPage() {
  const qc = useQueryClient();
  const router = useRouter();
  const { authFetch } = useAuth();
  const [form, setForm] = useState<CustomTestForm>(() => emptyForm());
  const [importText, setImportText] = useState('{"customTests":[]}');
  const titleInputRef = useRef<HTMLInputElement | null>(null);

  const customTestsQuery = useQuery({
    queryKey: ["admin-custom-tests"],
    queryFn: async () => {
      const res = await authFetch("/api/admin/custom-tests");
      const data = await jsonOrError(res);
      return Array.isArray(data.customTests) ? data.customTests : [];
    }
  });

  const selectedTest = useMemo(
    () => (customTestsQuery.data || []).find((customTest: CustomTestItem) => Number(customTest.id) === Number(form.id)) || null,
    [customTestsQuery.data, form.id]
  );
  const importableTopics = useMemo(
    () => ({ customTests: (customTestsQuery.data || []).map((customTest: CustomTestItem) => ({ title: customTest.title })) }),
    [customTestsQuery.data]
  );

  useEffect(() => {
    if (customTestsQuery.error) toast.error((customTestsQuery.error as any)?.message || "Xatolik");
  }, [customTestsQuery.error]);

  useEffect(() => {
    if (!selectedTest) return;
    setForm({
      id: selectedTest.id,
      title: selectedTest.title || ""
    });
  }, [selectedTest]);

  useEffect(() => {
    if (!form.id) return;
    titleInputRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    titleInputRef.current?.focus();
  }, [form.id]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await authFetch(form.id ? `/api/admin/custom-tests/${encodeURIComponent(String(form.id))}` : "/api/admin/custom-tests", {
        method: form.id ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: form.title })
      });
      return jsonOrError(res);
    },
    onSuccess: async () => {
      toast.success(form.id ? "Test yangilandi" : "Test qo‘shildi");
      setForm(emptyForm());
      await qc.invalidateQueries({ queryKey: ["admin-custom-tests"] });
    },
    onError: (error: any) => toast.error(error?.message || "Xatolik")
  });

  const deleteMutation = useMutation({
    mutationFn: async (topicId: number) => {
      const res = await authFetch(`/api/admin/custom-tests/${encodeURIComponent(String(topicId))}`, { method: "DELETE" });
      return jsonOrError(res);
    },
    onSuccess: async () => {
      toast.success("Test o‘chirildi");
      setForm(emptyForm());
      await qc.invalidateQueries({ queryKey: ["admin-custom-tests"] });
    },
    onError: (error: any) => toast.error(error?.message || "Xatolik")
  });

  const deleteAllMutation = useMutation({
    mutationFn: async () => {
      const res = await authFetch("/api/admin/custom-tests", { method: "DELETE" });
      return jsonOrError(res);
    },
    onSuccess: async (data: any) => {
      const deletedCount = Number(data?.deletedCount || 0);
      toast.success(deletedCount ? `${deletedCount} ta test o‘chirildi` : "Testlar o‘chirildi");
      setForm(emptyForm());
      await qc.invalidateQueries({ queryKey: ["admin-custom-tests"] });
    },
    onError: (error: any) => toast.error(error?.message || "Xatolik")
  });

  const importMutation = useMutation({
    mutationFn: async () => {
      const payload = parseCustomTestPayload(importText);
      const res = await authFetch("/api/admin/custom-tests/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ customTests: payload })
      });
      return jsonOrError(res);
    },
    onSuccess: async () => {
      toast.success("Testlar import qilindi");
      await qc.invalidateQueries({ queryKey: ["admin-custom-tests"] });
    },
    onError: (error: any) => toast.error(error?.message || "Xatolik")
  });

  return (
    <section className="adminSectionPage">
      <div className="adminSectionHeader">
        <button className="btn btn-ghost" type="button" onClick={() => qc.invalidateQueries({ queryKey: ["admin-custom-tests"] })}>
          <RefreshCw className="lucide" aria-hidden="true" /> Yangilash
        </button>
        <button
          className="btn btn-danger"
          type="button"
          onClick={() => {
            const count = customTestsQuery.data?.length || 0;
            if (!count) return toast("O‘chirish uchun test yo‘q");
            if (!window.confirm(`Barcha ${count} ta testni o‘chirishni tasdiqlaysizmi? Bu qaytarilmaydi.`)) return;
            deleteAllMutation.mutate();
          }}
          disabled={deleteAllMutation.isPending || !customTestsQuery.data?.length}
        >
          <Trash2 className="lucide" aria-hidden="true" /> Hammasini o‘chirish
        </button>
      </div>

      <div className="card adminPanelCard">
        <div className="adminPanelCardHead">
          <div className="adminPanelCardTitle">
            <LayoutGrid className="lucide" aria-hidden="true" /> Test qo‘shish / tahrirlash
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
            placeholder="Test nomi"
            value={form.title}
            onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
          />

          <div className="adminOptionsToolbar">
            <button className="btn btn-primary" type="submit" disabled={saveMutation.isPending || !form.title.trim()}>
              <Save className="lucide" aria-hidden="true" /> Saqlash
            </button>
            <button className="btn btn-ghost" type="button" onClick={() => setForm(emptyForm())}>
              Yangi test
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
          placeholder='{"customTests":[{"title":"20 ta"},{"title":"40 ta"}]}'
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
        {(customTestsQuery.data || []).map((customTest: CustomTestItem, index: number) => (
          <article
            key={customTest.id}
            className={`card adminTopicCard ${form.id === customTest.id ? "active" : ""}`}
            role="button"
            tabIndex={0}
            onClick={() => router.push(`/admin/custom/${customTest.id}`)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") router.push(`/admin/custom/${customTest.id}`);
            }}
          >
            <div className="adminTopicBody">
              <div className="adminTopicTop">
                <div>
                  <Link href={`/admin/custom/${customTest.id}`} className="adminTopicTitleLink">
                    <div className="adminTopicTitle">{customTest.title}</div>
                  </Link>
                </div>
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
                    id: customTest.id,
                    title: customTest.title
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
                  if (!window.confirm("Testni o‘chirishni tasdiqlaysizmi?")) return;
                  deleteMutation.mutate(customTest.id);
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
