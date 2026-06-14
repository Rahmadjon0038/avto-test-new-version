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
                <h3 className="videoLessonTitle">{video.title || video.topicTitle}</h3>
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
  poster = ""
}: {
  src: string;
  loading: boolean;
  error: string;
  onRetry: () => void;
  poster?: string;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;

    const cleanup = () => {
      hlsRef.current?.destroy();
      hlsRef.current = null;
      video.pause();
      video.removeAttribute("src");
      video.load();
    };

    if (Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        backBufferLength: 90
      });
      hlsRef.current = hls;
      hls.loadSource(src);
      hls.attachMedia(video);
    } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = src;
    }

    return () => {
      cleanup();
    };
  }, [src]);

  return (
    <div className="videoPlayerWrap">
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
    </div>
  );
}
