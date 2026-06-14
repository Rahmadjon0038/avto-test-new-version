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
import { jsonOrError } from "@/lib/api-authed";
import Hls from "hls.js";

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

type UploadResponse = {
  video?: VideoLesson;
  ok?: boolean;
  error?: string;
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

export default function AdminVideosPage() {
  const qc = useQueryClient();
  const router = useRouter();
  const { authFetch, accessToken } = useAuth();
  const backendUploadBaseUrl = process.env.NEXT_PUBLIC_BACKEND_URL || "https://api.road-test.uz";
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [form, setForm] = useState<VideoForm>(() => emptyForm());
  const [selectedFileName, setSelectedFileName] = useState("");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [saving, setSaving] = useState(false);
  const [playerErrors, setPlayerErrors] = useState<Record<number, string>>({});

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
    return new Promise<VideoLesson>((resolve, reject) => {
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
      toast.error("Dars mavzusi tanlang");
      return;
    }

    try {
      setSaving(true);
      setUploadProgress(0);
      setSelectedFileName(form.file?.name || "");
      if (!form.file) {
        throw new Error("Video fayl tanlang");
      }
      const uploadedVideo = await uploadRawVideo(`${backendUploadBaseUrl}/api/admin/video-lessons`, form.file, form);
      qc.setQueryData<VideoLesson[]>(["admin-video-lessons"], (current = []) => {
        const next = current.filter((video) => video.id !== uploadedVideo.id);
        return [uploadedVideo, ...next];
      });

      toast.success("Video yuklandi");
      setForm(emptyForm());
      setSelectedFileName("");
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
                {
                  const file = event.target.files?.[0] || null;
                  setSelectedFileName(file?.name || "");
                  setForm((current) => ({
                    ...current,
                    file
                  }));
                }
              }
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
              Yangi video
            </button>
          </div>

          {selectedFileName ? <div className="adminSelectedFile">Tanlangan fayl: {selectedFileName}</div> : null}

          <div className="adminOptionsToolbar">
            <button className="btn btn-primary" type="submit" disabled={saving || !form.topicId || !form.file}>
              <Save className="lucide" aria-hidden="true" /> {saving ? "Yuklanmoqda..." : "Saqlash"}
            </button>
            {uploadProgress > 0 ? (
              <div className="adminUploadProgress">
                <div className="adminUploadProgressBar" style={{ width: `${uploadProgress}%` }} />
                <span>{uploadProgress}%</span>
              </div>
            ) : saving ? (
              <div className="adminUploadProgress">
                <div className="adminUploadProgressBar indeterminate" />
                <span>Yuklanmoqda...</span>
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
                  <AdminInlinePlayer
                    video={video}
                    playerError={playerErrors[video.id] || ""}
                    onPlayerError={(message) =>
                      setPlayerErrors((current) => ({
                        ...current,
                        [video.id]: message
                      }))
                    }
                    onPlayerReady={() =>
                      setPlayerErrors((current) => ({
                        ...current,
                        [video.id]: ""
                      }))
                    }
                  />
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
                  <div className="adminPanelCardDesc">{video.description || "Video darsi"}</div>
                  <div className="adminVideoMetaLine">
                    <span>{formatDuration(video.videoDuration)}</span>
                    <span>Ochiq</span>
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

function AdminInlinePlayer({
  video,
  playerError,
  onPlayerError,
  onPlayerReady
}: {
  video: VideoLesson;
  playerError: string;
  onPlayerError: (message: string) => void;
  onPlayerReady: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const element = videoRef.current;
    if (!element || !video.playbackUrl) return undefined;

    let hls: Hls | null = null;
    let destroyed = false;

    const handleReady = () => {
      if (!destroyed) onPlayerReady();
    };

    const handleError = () => {
      if (!destroyed) onPlayerError("Video yuklanmadi");
    };

    element.addEventListener("loadeddata", handleReady);
    element.addEventListener("canplay", handleReady);
    element.addEventListener("error", handleError);

    if (Hls.isSupported()) {
      hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false
      });
      hls.loadSource(video.playbackUrl);
      hls.attachMedia(element);
    } else if (element.canPlayType("application/vnd.apple.mpegurl")) {
      element.src = video.playbackUrl;
    } else {
      onPlayerError("Bu brauzer video formatni qo‘llamaydi");
    }

    return () => {
      destroyed = true;
      element.removeEventListener("loadeddata", handleReady);
      element.removeEventListener("canplay", handleReady);
      element.removeEventListener("error", handleError);
      hls?.destroy();
      element.pause();
      element.removeAttribute("src");
      element.load();
    };
  }, [video.playbackUrl, onPlayerError, onPlayerReady]);

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
          <div className="videoPlayerPlaceholderText">Playback URL tayyor emas</div>
        </div>
      ) : null}
      {playerError ? (
        <div className="videoPlayerOverlay videoPlayerOverlayError">
          <div className="videoPlayerPlaceholderText">{playerError}</div>
        </div>
      ) : null}
    </div>
  );
}
