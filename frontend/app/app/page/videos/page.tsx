"use client";

import { useEffect, useRef, useState } from "react";
import Hls from "hls.js";
import { ArrowLeft, CircleAlert, Play, RefreshCw, Video } from "lucide-react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { useAuth } from "@/app/auth-provider";
import { jsonOrError } from "@/lib/api-authed";

type VideoLesson = {
  id: number;
  topicId: number;
  topicTitle: string;
  title: string;
  description: string;
  category: string;
  premiumOnly: boolean;
  videoStatus: string;
  videoDuration: number;
  videoThumbnail: string;
  thumbnailUrl: string;
  playbackUrl: string;
};

function formatDuration(totalSeconds: number) {
  const value = Number(totalSeconds || 0);
  if (!value) return "—";
  const minutes = Math.floor(value / 60);
  const seconds = value % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function statusLabel(status: string) {
  const normalized = String(status || "").toLowerCase();
  if (normalized === "ready") return "Tayyor";
  if (normalized === "failed") return "Xatolik";
  return "Yuklanmoqda";
}

export default function VideosPage() {
  const router = useRouter();
  const { authFetch, authReady } = useAuth();
  const [selectedVideoId, setSelectedVideoId] = useState<number | null>(null);
  const [playbackUrl, setPlaybackUrl] = useState("");
  const [loadingPlayback, setLoadingPlayback] = useState(false);
  const [playerError, setPlayerError] = useState("");
  const [retrySeed, setRetrySeed] = useState(0);

  const videosQuery = useQuery({
    queryKey: ["video-lessons"],
    enabled: authReady,
    queryFn: async () => {
      const res = await authFetch("/api/video-lessons");
      const data = await jsonOrError(res);
      return Array.isArray(data.videos) ? (data.videos as VideoLesson[]) : [];
    }
  });

  useEffect(() => {
    if (videosQuery.error) {
      toast.error((videosQuery.error as any)?.message || "Xatolik");
    }
  }, [videosQuery.error]);

  const videos = videosQuery.data || [];

  const loadPlayback = async (video: VideoLesson) => {
    setSelectedVideoId(video.id);
    setPlaybackUrl("");
    setPlayerError("");
    setLoadingPlayback(true);
    try {
      const res = await authFetch(`/api/video-lessons/${encodeURIComponent(String(video.id))}/playback`);
      const data = await jsonOrError(res);
      if (!res.ok) {
        throw new Error(data?.error || "Playback yuklanmadi");
      }
      const nextPlaybackUrl = data?.playbackUrl ? String(data.playbackUrl) : "";
      if (!nextPlaybackUrl) {
        throw new Error("Playback URL topilmadi");
      }
      setPlaybackUrl(nextPlaybackUrl);
      setRetrySeed((current) => current + 1);
    } catch (error: any) {
      const message = error?.message || "Video ochilmadi";
      setPlayerError(message);
      toast.error(message);
    } finally {
      setLoadingPlayback(false);
    }
  };

  if (!authReady) {
    return (
      <section className="view">
        <div className="muted">Video darslar yuklanmoqda...</div>
      </section>
    );
  }

  return (
    <section className="view">
      <div className="ticketHeader">
        <button className="btn btn-ghost btn-sm" type="button" onClick={() => router.push("/app")}>
          <ArrowLeft className="lucide" aria-hidden="true" /> Orqaga
        </button>
        <div className="h2" style={{ margin: 0 }}>
          Video darsliklar
        </div>
      </div>

      {videosQuery.isLoading ? <div className="muted">Video darslar yuklanmoqda...</div> : null}

      {videos.length ? (
        <div className="videoLessonsGrid">
          {videos.map((video) => (
            <article
              key={video.id}
              className={`videoLessonCard ${selectedVideoId === video.id ? "active" : ""}`}
              onClick={() => void loadPlayback(video)}
              role="button"
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  void loadPlayback(video);
                }
              }}
            >
              <div className="videoLessonFrameWrap">
                {selectedVideoId === video.id ? (
                  <BunnyHlsPlayer
                    key={`${video.id}-${retrySeed}`}
                    src={playbackUrl}
                    loading={loadingPlayback}
                    error={playerError}
                    onRetry={() => void loadPlayback(video)}
                    compact
                    poster={video.videoThumbnail || ""}
                  />
                ) : video.videoThumbnail ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img className="videoLessonThumb" src={video.videoThumbnail} alt={video.title || video.topicTitle} />
                ) : (
                  <div className="videoLessonThumb videoLessonThumbFallback">
                    <Video className="lucide" aria-hidden="true" />
                  </div>
                )}
                {selectedVideoId !== video.id ? (
                  <>
                    <div className="videoLessonPlay">
                      <Play className="lucide" aria-hidden="true" />
                    </div>
                    {video.premiumOnly ? <span className="videoLessonPremium">Premium</span> : null}
                  </>
                ) : null}
              </div>
              <div className="videoLessonBody">
                <div className="videoLessonTopRow">
                  <span className="videoLessonDuration">{formatDuration(video.videoDuration)}</span>
                  <span className={`videoLessonStatus videoLessonStatus-${String(video.videoStatus || "").toLowerCase()}`}>
                    {statusLabel(video.videoStatus)}
                  </span>
                </div>
                <h3 className="videoLessonTitle">{video.title || video.topicTitle}</h3>
                <p className="videoLessonDescription">{video.description || video.topicTitle}</p>
                <div className="videoLessonActions">
                  <button
                    className="btn btn-primary btn-sm videoLessonTopicBtn"
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      void loadPlayback(video);
                    }}
                    disabled={selectedVideoId === video.id && loadingPlayback}
                  >
                    {selectedVideoId === video.id ? "Player ochildi" : "Videoni ochish"}
                  </button>
                  <button
                    className="btn btn-ghost btn-sm videoLessonTopicBtn"
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      router.push(`/app/page/topics/${video.topicId}`);
                    }}
                  >
                    Mavzuga doir testlar
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : videosQuery.isLoading ? null : (
        <div className="card" style={{ padding: 16 }}>
          <div className="muted">Hozircha videodarslar mavjud emas</div>
        </div>
      )}
    </section>
  );
}

function BunnyHlsPlayer({
  src,
  loading,
  error,
  onRetry,
  compact = false,
  poster = ""
}: {
  src: string;
  loading: boolean;
  error: string;
  onRetry: () => void;
  compact?: boolean;
  poster?: string;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const pauseHandlerRef = useRef<(() => void) | null>(null);
  const [speed, setSpeed] = useState(1);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;

    let destroyed = false;
    const cleanup = () => {
      hlsRef.current?.destroy();
      hlsRef.current = null;
      video.pause();
      video.removeAttribute("src");
      video.load();
    };

    setPlaying(false);
    video.playbackRate = speed;

    const onLoaded = () => {
      if (!destroyed) {
        setPlaying(true);
      }
    };

    const onError = () => {
      if (!destroyed) {
        setPlaying(false);
      }
    };

    const pauseHandler = () => setPlaying(false);
    pauseHandlerRef.current = pauseHandler;
    video.addEventListener("canplay", onLoaded);
    video.addEventListener("playing", onLoaded);
    video.addEventListener("pause", pauseHandler);
    video.addEventListener("error", onError);

    if (Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        backBufferLength: 90
      });
      hlsRef.current = hls;
      hls.loadSource(src);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (!destroyed) {
          void video.play().catch(() => {});
        }
      });
      hls.on(Hls.Events.ERROR, (_, data) => {
        if (data.fatal && !destroyed) {
          setPlaying(false);
        }
      });
    } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = src;
      void video.play().catch(() => {});
    }

    return () => {
      destroyed = true;
      video.removeEventListener("canplay", onLoaded);
      video.removeEventListener("playing", onLoaded);
      if (pauseHandlerRef.current) {
        video.removeEventListener("pause", pauseHandlerRef.current);
      }
      video.removeEventListener("error", onError);
      cleanup();
    };
  }, [src, speed]);

  return (
    <div className={`videoPlayerWrap${compact ? " videoPlayerWrapCompact" : ""}`}>
      <div className="videoPlayerSurface">
        {loading ? (
          <div className="videoPlayerOverlay">
            <div className="videoPlayerSpinner" />
            <span>Video yuklanmoqda...</span>
          </div>
        ) : null}
        {error ? (
          <div className="videoPlayerOverlay videoPlayerOverlayError">
            <CircleAlert className="lucide" aria-hidden="true" />
            <span>{error}</span>
            <button className="btn btn-primary btn-sm" type="button" onClick={onRetry}>
              <RefreshCw className="lucide" aria-hidden="true" /> Qayta urinish
            </button>
          </div>
        ) : null}
        <video
          ref={videoRef}
          className="videoPlayerElement"
          controls
          playsInline
          preload="metadata"
          poster={poster || undefined}
        />
      </div>
      <div className="videoPlayerControls">
        <div className="videoPlayerControlGroup">
          <label className="videoPlayerSpeedLabel">
            Tezlik
            <select
              value={speed}
              onChange={(event) => setSpeed(Number(event.target.value))}
              className="videoPlayerSpeedSelect"
            >
              <option value={0.75}>0.75x</option>
              <option value={1}>1x</option>
              <option value={1.25}>1.25x</option>
              <option value={1.5}>1.5x</option>
              <option value={2}>2x</option>
            </select>
          </label>
        </div>
        <button
          className="btn btn-ghost btn-sm"
          type="button"
          onClick={() => {
            const video = videoRef.current;
            if (!video) return;
            if (document.fullscreenElement) {
              void document.exitFullscreen();
            } else {
              void video.parentElement?.requestFullscreen?.();
            }
          }}
        >
          Fullscreen
        </button>
        <div className="videoPlayerPlaybackState">{playing ? "O‘ynayapti" : "To‘xtagan"}</div>
      </div>
    </div>
  );
}
