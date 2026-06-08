"use client";

import { useEffect } from "react";
import { LayoutGrid } from "lucide-react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { fetchCustomTests } from "../custom-data";

export default function CustomTestsPage() {
  const router = useRouter();
  const customTestsQuery = useQuery({
    queryKey: ["custom-tests"],
    queryFn: fetchCustomTests
  });

  useEffect(() => {
    if (customTestsQuery.error) {
      toast.error((customTestsQuery.error as any)?.message || "Xatolik");
    }
  }, [customTestsQuery.error]);

  return (
    <section className="view">
      <div className="topicsHero card">
        <div className="topicsHeroIcon">
          <LayoutGrid className="lucide" aria-hidden="true" />
        </div>
        <div>
          <div className="topicsTitle">Sozlamali testlar</div>
          <div className="topicsSub">Kartaga bosganda shu testning alohida sahifasi ochiladi.</div>
        </div>
      </div>

      {customTestsQuery.isLoading ? <div className="muted">Testlar yuklanmoqda...</div> : null}

      <div className="topicsGrid">
        {(customTestsQuery.data || []).map((customTest, index) => (
          <button key={customTest.id} className="topicCard" type="button" onClick={() => router.push(`/app/page/custom/${customTest.id}`)}>
            <span className="topicIndex" aria-hidden="true">
              {String(index + 1).padStart(2, "0")}
            </span>
            <div className="topicNameRow">
              <div className="topicName">{customTest.title}</div>
              {typeof customTest.questionsCount === "number" ? (
                <div className="topicMeta">{customTest.questionsCount} savol</div>
              ) : null}
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}
