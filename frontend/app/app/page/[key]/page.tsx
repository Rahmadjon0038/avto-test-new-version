"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { useSiteLanguage } from "@/app/site-language-provider";

const comingSoonKeys = new Set<string>();

export default function StubPage() {
  const router = useRouter();
  const { t } = useSiteLanguage();
  const params = useParams<{ key: string }>();
  const key = String(params.key || "");
  const title =
    key === "topics"
      ? t("home.topicsTitle")
      : key === "custom"
        ? t("home.customTitle")
        : key === "mistakes"
          ? t("home.mistakesTitle")
          : key === "marathon"
            ? t("home.marathonTitle")
            : key === "videos"
              ? t("home.videosTitle")
              : key === "answers"
                ? t("home.answersTitle")
                : key === "exam"
                  ? t("home.examTitle")
                  : t("common.noData");
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
          <ArrowLeft className="lucide" aria-hidden="true" /> {t("common.back")}
        </button>
        <div>
          <div className="h2" style={{ margin: 0 }}>
            {title}
          </div>
          <div className="muted">{comingSoon ? t("home.menuSoon") : t("home.menuSoonTitle")}</div>
        </div>
      </div>

      <div className="card" style={{ padding: 14 }}>
        <div className="comingSoonCard">
          <div className="comingSoonPill">{t("home.menuSoon")}</div>
          <div className="comingSoonTitle">{title}</div>
          <div className="comingSoonText">
            {comingSoon ? t("home.comingSoonText") : t("home.comingSoonText")}
          </div>
        </div>
      </div>
    </section>
  );
}
