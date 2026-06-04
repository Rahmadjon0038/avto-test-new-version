"use client";

import { useParams, useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";

const titleMap: Record<string, string> = {
  topics: "Mavzu bo‘yicha testlar",
  custom: "Sozlamali testlar",
  mistakes: "Mening xatolarim",
  marathon: "Marafon rejimi",
  answers: "Barcha testlar javoblari",
  exam: "Imtihon topshirish"
};

export default function StubPage() {
  const router = useRouter();
  const params = useParams<{ key: string }>();
  const key = String(params.key || "");
  const title = titleMap[key] || "Bo‘lim";

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
          <div className="muted">Hozircha demo sahifa</div>
        </div>
      </div>

      <div className="card" style={{ padding: 14 }}>
        <div className="muted">Bu bo‘lim keyinroq to‘ldiriladi.</div>
      </div>
    </section>
  );
}

