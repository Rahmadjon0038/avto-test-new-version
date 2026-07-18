"use client";

import { useEffect } from "react";
import { ArrowLeft, LayoutGrid } from "lucide-react";
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
      <div className="sectionTopBar" style={{ marginBottom: 12 }}>
        <button className="btn btn-ghost btn-sm" type="button" onClick={() => router.push("/app")}>
          <ArrowLeft className="lucide" aria-hidden="true" /> Orqaga
        </button>
      </div>

        <div className="topicsHero card">
          <div className="topicsHeroIcon">
            <LayoutGrid className="lucide" aria-hidden="true" />
          </div>
          <div>
            <div className="topicsTitle">Sozlamali testlar</div>
            <div className="topicsSub">Kartalar biletlar bankidagi savollardan yig‘iladi.</div>
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
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}
