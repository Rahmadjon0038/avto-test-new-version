"use client";

import { useEffect } from "react";
import { ArrowLeft, LayoutGrid } from "lucide-react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { useAuth } from "@/app/auth-provider";
import { useSiteLanguage } from "@/app/site-language-provider";
import { jsonOrError } from "@/lib/api-authed";
import { fetchCustomTests } from "../custom-data";
import ProgressStatsBlock from "@/app/ui/progress-stats-block";

export default function CustomTestsPage() {
  const router = useRouter();
  const { authFetch, authReady } = useAuth();
  const { t, language } = useSiteLanguage();
  const customTestsQuery = useQuery({
    queryKey: ["custom-tests", language],
    queryFn: () => fetchCustomTests(language)
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
          <ArrowLeft className="lucide" aria-hidden="true" /> {t("common.back")}
        </button>
      </div>

        <div className="topicsHero card">
          <div className="topicsHeroIcon">
            <LayoutGrid className="lucide" aria-hidden="true" />
          </div>
          <div>
            <div className="topicsTitle">{t("custom.title")}</div>
            <div className="topicsSub">{t("custom.subtitle")}</div>
          </div>
        </div>

      {customTestsQuery.isLoading ? <div className="muted">{t("custom.loading")}</div> : null}

      <div className="topicsGrid">
        {(customTestsQuery.data || []).map((customTest, index) => (
          <button key={customTest.id} className="topicCard" type="button" onClick={() => router.push(`/app/page/custom/${customTest.id}`)}>
            <span className="topicIndex" aria-hidden="true">
              {String(index + 1).padStart(2, "0")}
            </span>
            <div className="topicNameRow">
              <div className="topicName">{customTest.title}</div>
              <CustomProgressPreview
                testId={customTest.id}
                questionsCount={customTest.questionsCount || 0}
                authFetch={authFetch}
                authReady={authReady}
                language={language}
              />
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}

type CustomProgress = {
  answers?: Record<string, number>;
  score?: number;
  completed?: boolean;
};

type AuthFetch = ReturnType<typeof useAuth>["authFetch"];

function CustomProgressPreview({
  testId,
  questionsCount,
  authFetch,
  authReady,
  language
}: {
  testId: number;
  questionsCount: number;
  authFetch: AuthFetch;
  authReady: boolean;
  language: string;
}) {
  const progressQuery = useQuery({
    queryKey: ["custom-test-progress", testId, language],
    queryFn: async () => {
      const res = await authFetch(`/api/custom-test-progress/${encodeURIComponent(String(testId))}`);
      const data = await jsonOrError(res);
      return (data?.progress || null) as CustomProgress | null;
    },
    enabled: authReady
  });

  if (!authReady || progressQuery.isLoading) return null;

  const progress = progressQuery.data;
  if (!progress || !questionsCount) return null;

  const answeredCount = Object.keys(progress.answers || {}).length;
  const correctCount = Number(progress.score || 0);
  const wrongCount = Math.max(0, answeredCount - correctCount);
  const unansweredCount = Math.max(0, questionsCount - answeredCount);

  return (
    <ProgressStatsBlock
      correct={correctCount}
      wrong={wrongCount}
      unanswered={unansweredCount}
      className="topicProgressStats"
    />
  );
}
