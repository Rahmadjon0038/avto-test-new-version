"use client";

import { useEffect } from "react";
import { ArrowLeft, ChevronRight } from "lucide-react";
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

function buildEmbedUrl(youtubeId: string) {
  return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(youtubeId)}?rel=0&modestbranding=1`;
}

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
        <div className="h2" style={{ margin: 0 }}>
          Video darsliklar
        </div>
      </div>

      {videosQuery.isLoading ? <div className="muted">Video darslar yuklanmoqda...</div> : null}

      {videosQuery.data?.length ? (
        <div className="videoLessonsGrid">
          {videosQuery.data.map((video) => (
            <article
              key={video.id}
              className="videoLessonCard"
            >
              <div className="videoLessonFrameWrap">
                <iframe
                  className="videoLessonFrame"
                  src={buildEmbedUrl(video.youtubeId)}
                  title={video.topicTitle}
                  loading="lazy"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  allowFullScreen
                />
              </div>
              <button
                className="videoLessonTopic"
                type="button"
                onClick={() => router.push(`/app/page/topics/${video.topicId}`)}
              >
                <span className="videoLessonTopicText">{video.topicTitle}</span>
                <ChevronRight className="lucide" aria-hidden="true" />
              </button>
              <button
                className="btn btn-primary btn-sm videoLessonTopicBtn"
                type="button"
                onClick={() => router.push(`/app/page/topics/${video.topicId}`)}
              >
                Mavzuga doir testlarni ishlash
              </button>
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
