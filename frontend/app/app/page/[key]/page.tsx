"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";

const titleMap: Record<string, string> = {
  topics: "Mavzu bo‘yicha testlar",
  custom: "Sozlamali testlar",
  mistakes: "Mening xatolarim",
  marathon: "Marafon rejimi",
  videos: "Video darsliklar",
  answers: "Barcha testlar javoblari",
  exam: "Imtihon topshirish"
};

const comingSoonKeys = new Set<string>();

export default function StubPage() {
  const router = useRouter();
  const params = useParams<{ key: string }>();
  const key = String(params.key || "");
  const title = titleMap[key] || "Bo‘lim";
  const comingSoon = comingSoonKeys.has(key);

  useEffect(() => {
    if (comingSoon) router.replace("/app");
  }, [comingSoon, router]);

  if (comingSoon) {
    return null;
  }

  return (
    <section className="view">
      <div className="ticketHeader">
        <button className="btn btn-ghost" type="button" onClick={() => router.push("/app")}>
          <ArrowLeft className="lucide" aria-hidden="true" /> Orqaga
        </button>
        <div>
          <div className="h2" style={{ margin: 0 }}>
            {title}
          </div>
          <div className="muted">{comingSoon ? "Tez kunda ishga tushadi" : "Hozircha demo sahifa"}</div>
        </div>
      </div>

      <div className="card" style={{ padding: 14 }}>
        <div className="comingSoonCard">
          <div className="comingSoonPill">Tez kunda</div>
          <div className="comingSoonTitle">{title}</div>
          <div className="comingSoonText">
            {comingSoon ? "Bu bo‘lim hozircha yopiq. Tayyor bo‘lganda avtomatik ochiladi." : "Bu bo‘lim keyinroq to‘ldiriladi."}
          </div>
        </div>
      </div>
    </section>
  );
}
