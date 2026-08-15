"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, LayoutGrid } from "lucide-react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { useAuth } from "@/app/auth-provider";
import { useSiteLanguage } from "@/app/site-language-provider";
import { fetchCustomTests, type CustomTestCard } from "../custom-data";
import { getLocalGeneratedCustomTestSizes, getLocalGeneratedCustomTest } from "@/lib/answer-bank";
import { putCachedCustomTest } from "@/lib/content-db";
import { ensureSynced } from "@/lib/content-sync";

export default function CustomTestsPage() {
  const router = useRouter();
  const { authFetch, authReady } = useAuth();
  const { t, language } = useSiteLanguage();

  // Local-first: "Sozlamali testlar" are a deterministic function of the already-cached ticket
  // bank (see lib/answer-bank.ts), so the list and each test's content are reconstructed
  // client-side with no network call, and pre-written into the customTests IndexedDB store so
  // opening one is instant (custom/[testId]/page.tsx already reads that cache first).
  const [localTests, setLocalTests] = useState<CustomTestCard[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const sizes = await getLocalGeneratedCustomTestSizes();
      const cards: CustomTestCard[] = [];
      for (const size of sizes) {
        const test = await getLocalGeneratedCustomTest(size);
        if (!test) continue;
        await putCachedCustomTest(test);
        cards.push({ id: test.id, title: test.title, questionsCount: test.questionsCount });
      }
      if (!cancelled) setLocalTests(cards);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!authReady) return;
    ensureSynced(authFetch).catch(() => {});
  }, [authReady, authFetch]);

  const customTestsQuery = useQuery({
    queryKey: ["custom-tests", language],
    queryFn: () => fetchCustomTests(language),
    enabled: localTests !== null && localTests.length === 0,
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: false
  });

  useEffect(() => {
    if (customTestsQuery.error) {
      toast.error((customTestsQuery.error as any)?.message || "Xatolik");
    }
  }, [customTestsQuery.error]);

  const items = localTests && localTests.length ? localTests : customTestsQuery.data || [];
  const isLoading = localTests === null && customTestsQuery.isLoading;

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

      {isLoading ? <div className="muted">{t("custom.loading")}</div> : null}

      <div className="topicsGrid">
        {items.map((customTest, index) => (
          <button
            key={customTest.id}
            className="topicCard topicCardCentered topicCardLarge"
            type="button"
            onClick={() => router.push(`/app/page/custom/${customTest.id}`)}
          >
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
