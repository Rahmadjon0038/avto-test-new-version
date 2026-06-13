"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Link2, RefreshCw, Save, Trash2, Video } from "lucide-react";
import toast from "react-hot-toast";
import { useAuth } from "@/app/auth-provider";
import { jsonOrError } from "@/lib/api-authed";

type TopicChoice = {
  id: number;
  title: string;
};

type VideoLesson = {
  id: number;
  topicId: number;
  topicTitle: string;
  youtubeUrl: string;
  youtubeId: string;
  thumbnailUrl: string;
};

type VideoForm = {
  id: number | null;
  topicId: string;
  youtubeUrl: string;
};

const emptyForm = (): VideoForm => ({
  id: null,
  topicId: "",
  youtubeUrl: ""
});

export default function AdminVideosPage() {
  const qc = useQueryClient();
  const router = useRouter();
  const { authFetch } = useAuth();
  const linkInputRef = useRef<HTMLInputElement | null>(null);
  const [form, setForm] = useState<VideoForm>(() => emptyForm());

  const topicsQuery = useQuery({
    queryKey: ["admin-videos-topics"],
    queryFn: async () => {
      const res = await authFetch("/api/admin/topics");
      const data = await jsonOrError(res);
      return Array.isArray(data.topics) ? (data.topics as TopicChoice[]) : [];
    }
  });

  const videosQuery = useQuery({
    queryKey: ["admin-videos"],
    queryFn: async () => {
      const res = await authFetch("/api/admin/videos");
      const data = await jsonOrError(res);
      return Array.isArray(data.videos) ? (data.videos as VideoLesson[]) : [];
    }
  });

  const selectedVideo = useMemo(
    () => (videosQuery.data || []).find((video) => Number(video.id) === Number(form.id)) || null,
    [videosQuery.data, form.id]
  );

  useEffect(() => {
    if (topicsQuery.error) toast.error((topicsQuery.error as any)?.message || "Xatolik");
  }, [topicsQuery.error]);

  useEffect(() => {
    if (videosQuery.error) toast.error((videosQuery.error as any)?.message || "Xatolik");
  }, [videosQuery.error]);

  useEffect(() => {
    if (!selectedVideo) return;
    setForm({
      id: selectedVideo.id,
      topicId: String(selectedVideo.topicId || ""),
      youtubeUrl: selectedVideo.youtubeUrl || ""
    });
  }, [selectedVideo]);

  useEffect(() => {
    if (!form.id) return;
    linkInputRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    linkInputRef.current?.focus();
  }, [form.id]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const topicId = Number(form.topicId);
      const res = await authFetch(form.id ? `/api/admin/videos/${encodeURIComponent(String(form.id))}` : "/api/admin/videos", {
        method: form.id ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          topicId,
          youtubeUrl: form.youtubeUrl
        })
      });
      return jsonOrError(res);
    },
    onSuccess: async () => {
      toast.success(form.id ? "Video yangilandi" : "Video qo‘shildi");
      setForm(emptyForm());
      await qc.invalidateQueries({ queryKey: ["admin-videos"] });
    },
    onError: (error: any) => toast.error(error?.message || "Xatolik")
  });

  const deleteMutation = useMutation({
    mutationFn: async (videoId: number) => {
      const res = await authFetch(`/api/admin/videos/${encodeURIComponent(String(videoId))}`, {
        method: "DELETE"
      });
      return jsonOrError(res);
    },
    onSuccess: async () => {
      toast.success("Video o‘chirildi");
      setForm(emptyForm());
      await qc.invalidateQueries({ queryKey: ["admin-videos"] });
    },
    onError: (error: any) => toast.error(error?.message || "Xatolik")
  });

  return (
    <section className="adminSectionPage">
      <div className="adminSectionHeader">
        <button className="btn btn-ghost" type="button" onClick={() => router.push("/admin")}>
          <ArrowLeft className="lucide" aria-hidden="true" /> Orqaga
        </button>
        <button className="btn btn-ghost" type="button" onClick={() => qc.invalidateQueries({ queryKey: ["admin-videos"] })}>
          <RefreshCw className="lucide" aria-hidden="true" /> Yangilash
        </button>
      </div>

      <div className="card adminPanelCard">
        <div className="adminPanelCardHead">
          <div className="adminPanelCardTitle">
            <Video className="lucide" aria-hidden="true" /> Video joylash
          </div>
        </div>

        <form
          className="adminTopicForm"
          onSubmit={(event) => {
            event.preventDefault();
            saveMutation.mutate();
          }}
        >
          <select
            className="input"
            value={form.topicId}
            onChange={(event) => setForm((current) => ({ ...current, topicId: event.target.value }))}
          >
            <option value="">Dars / mavzu tanlang</option>
            {(topicsQuery.data || []).map((topic) => (
              <option key={topic.id} value={topic.id}>
                {topic.title}
              </option>
            ))}
          </select>

          <input
            ref={linkInputRef}
            className="input"
            placeholder="YouTube link"
            value={form.youtubeUrl}
            onChange={(event) => setForm((current) => ({ ...current, youtubeUrl: event.target.value }))}
          />

          <div className="adminOptionsToolbar">
            <button className="btn btn-primary" type="submit" disabled={saveMutation.isPending || !form.topicId || !form.youtubeUrl.trim()}>
              <Save className="lucide" aria-hidden="true" /> {form.id ? "Yangilash" : "Saqlash"}
            </button>
            <button className="btn btn-ghost" type="button" onClick={() => setForm(emptyForm())}>
              Yangi video
            </button>
          </div>
        </form>
      </div>

      <div className="adminTopicsGrid">
        {(videosQuery.data || []).map((video) => (
          <article
            key={video.id}
            className={`card adminTopicCard ${form.id === video.id ? "active" : ""}`}
            role="button"
            tabIndex={0}
            onClick={() => setForm({ id: video.id, topicId: String(video.topicId), youtubeUrl: video.youtubeUrl })}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                setForm({ id: video.id, topicId: String(video.topicId), youtubeUrl: video.youtubeUrl });
              }
            }}
          >
            <div className="adminTopicBody">
              <div className="adminTopicCheck active" aria-hidden="true">
                <Link2 className="lucide" aria-hidden="true" />
              </div>
              <div className="adminTopicMeta">
                <div className="adminTopicTitle">{video.topicTitle}</div>
                <div className="adminPanelCardDesc">{video.youtubeUrl}</div>
              </div>
            </div>
            <div className="adminTopicActions">
              <button
                className="btn btn-ghost btn-sm"
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  window.open(video.youtubeUrl, "_blank", "noopener,noreferrer");
                }}
              >
                Ko‘rish
              </button>
              <button
                className="btn btn-danger btn-sm"
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  if (!window.confirm("Ushbu videoni o‘chirasizmi?")) return;
                  deleteMutation.mutate(video.id);
                }}
                disabled={deleteMutation.isPending}
              >
                <Trash2 className="lucide" aria-hidden="true" /> O‘chirish
              </button>
            </div>
          </article>
        ))}
      </div>

      {!videosQuery.isLoading && !(videosQuery.data || []).length ? (
        <div className="adminEmpty card">
          <div className="adminEmptyTitle">Hozircha video darslar yo‘q</div>
        </div>
      ) : null}
    </section>
  );
}
