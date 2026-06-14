"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  CheckCircle2,
  Clock3,
  ChevronRight,
  RefreshCw,
  Save,
  Trash2,
  Video,
  XCircle
} from "lucide-react";
import toast from "react-hot-toast";
import { useAuth } from "@/app/auth-provider";
import { jsonOrError } from "@/lib/api-authed";

type TopicChoice = {
  id: number;
  title: string;
  slug?: string;
};

type VideoLesson = {
  id: number;
  topicId: number;
  topicTitle: string;
  title: string;
  description: string;
  category: string;
  premiumOnly: boolean;
  bunnyVideoId: string;
  bunnyLibraryId: string;
  videoStatus: "processing" | "ready" | "failed" | string;
  videoDuration: number;
  videoThumbnail: string;
  playbackUrl: string;
};

type VideoForm = {
  topicId: string;
  file: File | null;
};

const emptyForm = (): VideoForm => ({
  topicId: "",
  file: null
});

function formatDuration(totalSeconds: number) {
  const value = Number(totalSeconds || 0);
  if (!value) return "—";
  const minutes = Math.floor(value / 60);
  const seconds = value % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function statusMeta(status: string) {
  const normalized = String(status || "").toLowerCase();
  if (normalized === "ready") {
    return {
      label: "Ready",
      className: "success",
      icon: CheckCircle2
    };
  }
  if (normalized === "failed") {
    return {
      label: "Failed",
      className: "danger",
      icon: XCircle
    };
  }
  return {
    label: "Processing",
    className: "warning",
    icon: Clock3
  };
}

export default function AdminVideosPage() {
  const qc = useQueryClient();
  const router = useRouter();
  const { authFetch, accessToken } = useAuth();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [form, setForm] = useState<VideoForm>(() => emptyForm());
  const [uploadProgress, setUploadProgress] = useState(0);
  const [saving, setSaving] = useState(false);

  const topicsQuery = useQuery({
    queryKey: ["admin-video-topics"],
    queryFn: async () => {
      const res = await authFetch("/api/admin/topics");
      const data = await jsonOrError(res);
      return Array.isArray(data.topics) ? (data.topics as TopicChoice[]) : [];
    }
  });

  const videosQuery = useQuery({
    queryKey: ["admin-video-lessons"],
    queryFn: async () => {
      const res = await authFetch("/api/admin/video-lessons");
      const data = await jsonOrError(res);
      return Array.isArray(data.videos) ? (data.videos as VideoLesson[]) : [];
    },
    refetchInterval: 15000
  });

  useEffect(() => {
    if (topicsQuery.error) toast.error((topicsQuery.error as any)?.message || "Xatolik");
  }, [topicsQuery.error]);

  useEffect(() => {
    if (videosQuery.error) toast.error((videosQuery.error as any)?.message || "Xatolik");
  }, [videosQuery.error]);

  useEffect(() => {
    return undefined;
  }, []);

  const uploadRawVideo = (endpoint: string, file: File, meta: VideoForm) => {
    return new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", endpoint, true);
      if (accessToken) xhr.setRequestHeader("authorization", `Bearer ${accessToken}`);
      xhr.setRequestHeader("x-topic-id", meta.topicId);
      xhr.setRequestHeader("x-file-name", file.name || "video.mp4");
      xhr.setRequestHeader("content-type", file.type || "application/octet-stream");
      xhr.upload.onprogress = (event) => {
        if (!event.lengthComputable) return;
        setUploadProgress(Math.round((event.loaded / event.total) * 100));
      };
      xhr.onerror = () => reject(new Error("Video yuklashda tarmoq xatosi"));
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve();
          return;
        }
        try {
          const body = JSON.parse(xhr.responseText || "{}");
          reject(new Error(body.error || "Video yuklanmadi"));
        } catch {
          reject(new Error("Video yuklanmadi"));
        }
      };
      xhr.send(file);
    });
  };

  const saveVideo = async () => {
    const topicId = Number(form.topicId);
    if (!topicId) {
      toast.error("Dars mavzusi tanlang");
      return;
    }

    try {
      setSaving(true);
      setUploadProgress(0);
      if (!form.file) {
        throw new Error("Video fayl tanlang");
      }
      await uploadRawVideo("/api/video-lessons", form.file, form);

      toast.success("Video yuklandi");
      setForm(emptyForm());
      fileInputRef.current && (fileInputRef.current.value = "");
      await qc.invalidateQueries({ queryKey: ["admin-video-lessons"] });
    } catch (error: any) {
      toast.error(error?.message || "Xatolik");
    } finally {
      setSaving(false);
      setUploadProgress(0);
    }
  };

  const deleteVideo = async (videoId: number) => {
    if (!window.confirm("Ushbu videoni o‘chirasizmi?")) return;
    try {
      const res = await authFetch(`/api/video-lessons/${encodeURIComponent(String(videoId))}`, {
        method: "DELETE"
      });
      const data = await jsonOrError(res);
      if (!res.ok) throw new Error(data?.error || "Video o‘chirilmadi");
      toast.success("Video o‘chirildi");
      setForm(emptyForm());
      await qc.invalidateQueries({ queryKey: ["admin-video-lessons"] });
    } catch (error: any) {
      toast.error(error?.message || "Xatolik");
    }
  };

  const videos = videosQuery.data || [];

  return (
    <section className="adminSectionPage">
      <div className="adminSectionHeader">
        <button className="btn btn-ghost" type="button" onClick={() => router.push("/admin")}>
          <ArrowLeft className="lucide" aria-hidden="true" /> Orqaga
        </button>
        <button className="btn btn-ghost" type="button" onClick={() => qc.invalidateQueries({ queryKey: ["admin-video-lessons"] })}>
          <RefreshCw className="lucide" aria-hidden="true" /> Yangilash
        </button>
      </div>

      <div className="card adminPanelCard">
        <div className="adminPanelCardHead">
          <div className="adminPanelCardTitle">
            <Video className="lucide" aria-hidden="true" /> Bunny Stream video yuklash
          </div>
          <div className="adminPanelCardDesc">
            Faqat mavzuni tanlaysiz va video faylni yuklaysiz. Sarlavha va boshqa ma’lumotlar mavzudan avtomatik olinadi.
          </div>
        </div>

        <form
          className="adminTopicForm"
          onSubmit={(event) => {
            event.preventDefault();
            void saveVideo();
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

          <div className="adminUploadRow">
            <input
              ref={fileInputRef}
              className="input"
              type="file"
              accept="video/mp4,video/*"
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  file: event.target.files?.[0] || null
                }))
              }
            />
            <button
              className="btn btn-ghost"
              type="button"
              onClick={() => {
                setForm(emptyForm());
                if (fileInputRef.current) fileInputRef.current.value = "";
              }}
            >
              Yangi video
            </button>
          </div>

          <div className="adminOptionsToolbar">
            <button className="btn btn-primary" type="submit" disabled={saving || !form.topicId || !form.file}>
              <Save className="lucide" aria-hidden="true" /> Saqlash
            </button>
            {uploadProgress > 0 ? (
              <div className="adminUploadProgress">
                <div className="adminUploadProgressBar" style={{ width: `${uploadProgress}%` }} />
                <span>{uploadProgress}%</span>
              </div>
            ) : null}
          </div>
        </form>
      </div>

      <div className="adminTopicsGrid">
        {videos.map((video) => {
          const meta = statusMeta(video.videoStatus);
          const StatusIcon = meta.icon;
          return (
            <article key={video.id} className="card adminTopicCard">
              <div className="adminVideoPreview">
                {video.videoThumbnail ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img className="adminVideoThumb" src={video.videoThumbnail} alt={video.title || video.topicTitle} />
                ) : (
                  <div className="adminVideoThumbFallback">
                    <Video className="lucide" aria-hidden="true" />
                  </div>
                )}
                <div className={`adminVideoStatus adminVideoStatus-${meta.className}`}>
                  <StatusIcon className="lucide" aria-hidden="true" />
                  <span>{meta.label}</span>
                </div>
              </div>

              <div className="adminTopicBody">
                <div className="adminTopicCheck active" aria-hidden="true">
                  <Video className="lucide" aria-hidden="true" />
                </div>
                <div className="adminTopicMeta">
                  <div className="adminTopicTitle">{video.title || video.topicTitle}</div>
                  <div className="adminPanelCardDesc">{video.description || video.topicTitle}</div>
                  <div className="adminVideoMetaLine">
                    <span>{video.topicTitle}</span>
                    <span>{formatDuration(video.videoDuration)}</span>
                    <span>Ochiq</span>
                  </div>
                </div>
              </div>

              <div className="adminTopicActions">
                <button
                  className="btn btn-ghost btn-sm"
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    if (video.playbackUrl) {
                      window.open(video.playbackUrl, "_blank", "noopener,noreferrer");
                    } else {
                      toast.error("Playback URL tayyor emas");
                    }
                  }}
                >
                  Ko‘rish
                  <ChevronRight className="lucide" aria-hidden="true" />
                </button>
                <button
                  className="btn btn-danger btn-sm"
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    void deleteVideo(video.id);
                  }}
                  disabled={saving}
                >
                  <Trash2 className="lucide" aria-hidden="true" /> O‘chirish
                </button>
              </div>
            </article>
          );
        })}
      </div>

      {!videosQuery.isLoading && !videos.length ? (
        <div className="adminEmpty card">
          <div className="adminEmptyTitle">Hozircha video darslar yo‘q</div>
        </div>
      ) : null}
    </section>
  );
}
