"use client";

import { useEffect } from "react";
import { ArrowLeft, ChevronRight, Play, Video } from "lucide-react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { useAuth } from "@/app/auth-provider";
import { jsonOrError } from "@/lib/api-authed";

type VideoLesson = {
  id: number;
  topicId: number;
  topicTitle: string;
  youtubeUrl: string;
  youtubeId: string;
  thumbnailUrl: string;
};

export default function VideosPage() {
  const router = useRouter();
  const { authFetch, authReady } = useAuth();

  const videosQuery = useQuery({
    queryKey: ["videos"],
    enabled: authReady,
    queryFn: async () => {
      const res = await authFetch("/api/videos");
      const data = await jsonOrError(res);
      return Array.isArray(data.videos) ? (data.videos as VideoLesson[]) : [];
    }
  });

  useEffect(() => {
    if (videosQuery.error) {
      toast.error((videosQuery.error as any)?.message || "Xatolik");
    }
  }, [videosQuery.error]);

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
        <div>
          <div className="h2" style={{ margin: 0 }}>
            Video darsliklar
          </div>
          <div className="muted">Video darsni ochish uchun rasmga bosing, mavzu nomi esa test sahifasiga olib boradi.</div>
        </div>
      </div>

      {videosQuery.isLoading ? <div className="muted">Video darslar yuklanmoqda...</div> : null}

      {videosQuery.data?.length ? (
        <div className="videoLessonsGrid">
          {videosQuery.data.map((video) => (
            <article
              key={video.id}
              className="videoLessonCard"
              role="button"
              tabIndex={0}
              onClick={() => window.open(video.youtubeUrl, "_blank", "noopener,noreferrer")}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  window.open(video.youtubeUrl, "_blank", "noopener,noreferrer");
                }
              }}
            >
              <div className="videoLessonThumb">
                <img src={video.thumbnailUrl} alt={video.topicTitle} className="videoLessonImage" />
                <div className="videoLessonPlay">
                  <Play className="lucide" aria-hidden="true" />
                </div>
              </div>
              <button
                className="videoLessonTopic"
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  router.push(`/app/page/topics/${video.topicId}`);
                }}
              >
                <span className="videoLessonTopicText">{video.topicTitle}</span>
                <ChevronRight className="lucide" aria-hidden="true" />
              </button>
            </article>
          ))}
        </div>
      ) : videosQuery.isLoading ? null : (
        <div className="card" style={{ padding: 16 }}>
          <div className="muted">Hozircha video darslar yo‘q.</div>
        </div>
      )}

      <div className="videoLessonsInfo card">
        <div className="videoLessonsInfoIcon">
          <Video className="lucide" aria-hidden="true" />
        </div>
        <div>
          <div className="videoLessonsInfoTitle">Mavzuga bog‘langan video darslar</div>
          <div className="videoLessonsInfoText">
            Har bir video dars admin paneldan qo‘shiladi. Video ustiga bosilganda YouTube ochiladi, mavzu nomi esa shu mavzuning test sahifasiga olib boradi.
          </div>
        </div>
      </div>
    </section>
  );
}
