"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  RefreshCw,
  Save,
  Trash2,
  Video,
} from "lucide-react";
import toast from "react-hot-toast";
import { useAuth } from "@/app/auth-provider";
import { useSiteLanguage } from "@/app/site-language-provider";
import { jsonOrError } from "@/lib/api-authed";
import { appendLanguageQuery } from "@/lib/site-language";
import Hls from "hls.js";

type TopicChoice = {
  id: number;
  title: string;
  titleI18n?: {
    uz_latn?: string;
    uz_cyrl?: string;
    ru?: string;
  };
  slug?: string;
};

type VideoLesson = {
  id: number;
  topicId: number;
  topicTitle: string;
  title: string;
  titleI18n?: {
    uz_latn?: string;
    uz_cyrl?: string;
    ru?: string;
  };
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
  titleI18n: {
    uz_latn?: string;
    uz_cyrl?: string;
    ru?: string;
  };
  file: File | null;
};

type UploadResponse = {
  video?: VideoLesson;
  ok?: boolean;
  error?: string;
};

const emptyForm = (): VideoForm => ({
  topicId: "",
  titleI18n: {},
  file: null
});

function formatDuration(totalSeconds: number) {
  const value = Number(totalSeconds || 0);
  if (!value) return "—";
  const minutes = Math.floor(value / 60);
  const seconds = value % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export default function AdminVideosPage() {
  const qc = useQueryClient();
  const router = useRouter();
  const { t, language } = useSiteLanguage();
  const { authFetch, accessToken } = useAuth();
  const backendUploadBaseUrl = process.env.NEXT_PUBLIC_BACKEND_URL || "https://api.topshirdi.uz";
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [form, setForm] = useState<VideoForm>(() => emptyForm());
  const [selectedFileName, setSelectedFileName] = useState("");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [saving, setSaving] = useState(false);

  const topicsQuery = useQuery({
    queryKey: ["admin-video-topics", language],
    queryFn: async () => {
      const res = await authFetch(appendLanguageQuery("/api/admin/topics", language));
      const data = await jsonOrError(res);
      return Array.isArray(data.topics) ? (data.topics as TopicChoice[]) : [];
    }
  });

  const videosQuery = useQuery({
    queryKey: ["admin-video-lessons", language],
    queryFn: async () => {
      const res = await authFetch(appendLanguageQuery("/api/admin/video-lessons", language));
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

  const uploadRawVideo = (endpoint: string, file: File, meta: VideoForm) => {
    return new Promise<VideoLesson>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", endpoint, true);
      if (accessToken) xhr.setRequestHeader("authorization", `Bearer ${accessToken}`);
      xhr.setRequestHeader("x-topic-id", meta.topicId);
      xhr.setRequestHeader(
        "x-video-title-i18n",
        encodeURIComponent(JSON.stringify(meta.titleI18n || {}))
      );
      xhr.setRequestHeader("x-file-name", encodeURIComponent(file.name || "video.mp4"));
      xhr.setRequestHeader("content-type", file.type || "application/octet-stream");
      xhr.upload.onprogress = (event) => {
        if (!event.lengthComputable) return;
        setUploadProgress(Math.round((event.loaded / event.total) * 100));
      };
      xhr.onerror = () => reject(new Error("Video yuklashda tarmoq xatosi"));
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const body = JSON.parse(xhr.responseText || "{}") as UploadResponse;
            if (body.video) {
              resolve(body.video);
              return;
            }
            reject(new Error("Server javobi topilmadi"));
          } catch {
            reject(new Error("Server javobi topilmadi"));
          }
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
      toast.error(t("common.noData"));
      return;
    }

    try {
      setSaving(true);
      setUploadProgress(0);
      setSelectedFileName(form.file?.name || "");
      if (!form.file) {
        throw new Error(t("common.noData"));
      }
      const uploadedVideo = await uploadRawVideo(`${backendUploadBaseUrl}/api/admin/video-lessons`, form.file, form);
      qc.setQueryData<VideoLesson[]>(["admin-video-lessons", language], (current = []) => {
        const next = current.filter((video) => video.id !== uploadedVideo.id);
        return [uploadedVideo, ...next];
      });

      toast.success(t("common.save"));
      setForm(emptyForm());
      setSelectedFileName("");
      fileInputRef.current && (fileInputRef.current.value = "");
      await qc.invalidateQueries({ queryKey: ["admin-video-lessons", language] });
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
      await qc.invalidateQueries({ queryKey: ["admin-video-lessons", language] });
    } catch (error: any) {
      toast.error(error?.message || "Xatolik");
    }
  };

  const videos = videosQuery.data || [];
  const topicOptions = topicsQuery.data || [];

  return (
    <section className="adminSectionPage">
      <div className="adminSectionHeader">
        <button className="btn btn-ghost" type="button" onClick={() => router.push("/admin")}>
          <ArrowLeft className="lucide" aria-hidden="true" /> Orqaga
        </button>
        <button
          className="btn btn-ghost"
          type="button"
          onClick={() => qc.invalidateQueries({ queryKey: ["admin-video-lessons", language] })}
        >
          <RefreshCw className="lucide" aria-hidden="true" /> Yangilash
        </button>
      </div>

      <div className="card adminPanelCard">
        <div className="adminPanelCardHead">
          <div className="adminPanelCardTitle">
            <Video className="lucide" aria-hidden="true" /> {t("videos.adminTitle")}
          </div>
          <div className="adminPanelCardDesc">{t("videos.adminDesc")}</div>
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
            onChange={(event) => {
              const nextTopicId = event.target.value;
              const selectedTopic = topicOptions.find((topic) => String(topic.id) === nextTopicId) || null;
              const fallbackTitle = String(selectedTopic?.title || "").trim();
              setForm((current) => ({
                ...current,
                topicId: nextTopicId,
                titleI18n: selectedTopic?.titleI18n || {
                  uz_latn: fallbackTitle,
                  uz_cyrl: fallbackTitle,
                  ru: fallbackTitle
                }
              }));
            }}
          >
            <option value="">{t("videos.chooseTopic")}</option>
            {topicOptions.map((topic) => (
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
              onChange={(event) => {
                const file = event.target.files?.[0] || null;
                setSelectedFileName(file?.name || "");
                setForm((current) => ({
                  ...current,
                  file
                }));
              }}
            />
            <button
              className="btn btn-ghost"
              type="button"
              onClick={() => {
                setForm(emptyForm());
                setSelectedFileName("");
                if (fileInputRef.current) fileInputRef.current.value = "";
              }}
            >
              {t("videos.newVideo")}
            </button>
          </div>

          {selectedFileName ? (
            <div className="adminSelectedFile">
              {t("videos.selectedFile")}: {selectedFileName}
            </div>
          ) : null}

          <div className="adminOptionsToolbar">
            <button className="btn btn-primary" type="submit" disabled={saving || !form.topicId || !form.file}>
              <Save className="lucide" aria-hidden="true" /> {saving ? t("common.loading") : t("common.save")}
            </button>
            {uploadProgress > 0 ? (
              <div className="adminUploadProgress">
                <div className="adminUploadProgressBar" style={{ width: `${uploadProgress}%` }} />
                <span>{uploadProgress}%</span>
              </div>
            ) : saving ? (
              <div className="adminUploadProgress">
                <div className="adminUploadProgressBar indeterminate" />
                <span>{t("common.loading")}</span>
              </div>
            ) : null}
          </div>
        </form>
      </div>

      <div className="adminTopicsGrid">
        {videos.map((video) => {
          return (
            <article key={video.id} className="card adminTopicCard">
              <div className="adminVideoPreview">
                {video.playbackUrl ? (
                  <AdminInlinePlayer video={video} t={t} />
                ) : video.videoThumbnail ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img className="adminVideoThumb" src={video.videoThumbnail} alt={video.title || video.topicTitle} />
                ) : (
                  <div className="adminVideoThumbFallback">
                    <Video className="lucide" aria-hidden="true" />
                  </div>
                )}
              </div>

              <div className="adminTopicBody">
                <div className="adminTopicMeta">
                  <div className="adminTopicTitle adminTopicTitleOneLine">{video.title || video.topicTitle}</div>
                  <div className="adminPanelCardDesc">{video.description || t("videos.itemFallbackDesc")}</div>
                  <div className="adminVideoMetaLine">
                    <span>{formatDuration(video.videoDuration)}</span>
                    <span>{t("videos.open")}</span>
                  </div>
                </div>
              </div>
              <div className="adminTopicActions">
                <button
                  className="btn btn-danger btn-sm"
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    void deleteVideo(video.id);
                  }}
                  disabled={saving}
                >
                  <Trash2 className="lucide" aria-hidden="true" /> {t("videos.delete")}
                </button>
              </div>
            </article>
          );
        })}
      </div>

      {!videosQuery.isLoading && !videos.length ? (
        <div className="adminEmpty card">
          <div className="adminEmptyTitle">{t("videos.noVideos")}</div>
        </div>
      ) : null}
    </section>
  );
}

function AdminInlinePlayer({
  video,
  t
}: {
  video: VideoLesson;
  t: (key: string) => string;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const element = videoRef.current;
    if (!element || !video.playbackUrl) return undefined;

    let hls: Hls | null = null;

    if (Hls.isSupported()) {
      hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false
      });
      hls.loadSource(video.playbackUrl);
      hls.attachMedia(element);
    } else if (element.canPlayType("application/vnd.apple.mpegurl")) {
      element.src = video.playbackUrl;
    }

    return () => {
      hls?.destroy();
      element.pause();
      element.removeAttribute("src");
      element.load();
    };
  }, [video.playbackUrl]);

  return (
    <div className="videoPlayerSurface adminInlinePlayerSurface">
      <video
        ref={videoRef}
        className="videoPlayerElement"
        controls
        playsInline
        preload="metadata"
        poster={video.videoThumbnail || undefined}
      />
      {!video.playbackUrl ? (
        <div className="videoPlayerOverlay">
          <div className="videoPlayerPlaceholderText">{t("videos.playbackMissing")}</div>
        </div>
      ) : null}
    </div>
  );
}
