"use client";

import { useEffect } from "react";
import { LayoutGrid } from "lucide-react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { fetchTopics } from "../topics-data";

export default function TopicsPage() {
  const router = useRouter();
  const topicsQuery = useQuery({
    queryKey: ["topics"],
    queryFn: fetchTopics
  });

  useEffect(() => {
    if (topicsQuery.error) {
      toast.error((topicsQuery.error as any)?.message || "Xatolik");
    }
  }, [topicsQuery.error]);

  return (
    <section className="view">
      <div className="topicsHero card">
        <div className="topicsHeroIcon">
          <LayoutGrid className="lucide" aria-hidden="true" />
        </div>
        <div>
          <div className="topicsTitle">Mavzularni tanlang</div>
          <div className="topicsSub">Kartaga bosganda shu mavzuning alohida sahifasi ochiladi.</div>
        </div>
      </div>

      {topicsQuery.isLoading ? <div className="muted">Mavzular yuklanmoqda...</div> : null}

      <div className="topicsGrid">
        {(topicsQuery.data || []).map((topic, index) => (
          <button key={topic.id} className="topicCard" type="button" onClick={() => router.push(`/app/page/topics/${topic.id}`)}>
            <span className="topicIndex" aria-hidden="true">
              {String(index + 1).padStart(2, "0")}
            </span>
            <div className="topicName">{topic.title}</div>
          </button>
        ))}
      </div>
    </section>
  );
}
