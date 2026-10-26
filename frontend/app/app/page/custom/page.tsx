"use client";

import { useEffect } from "react";
import { ArrowLeft, LayoutGrid } from "lucide-react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { useAuth } from "@/app/auth-provider";
import { useSiteLanguage } from "@/app/site-language-provider";
import { fetchCustomTests, type CustomTestCard } from "../custom-data";
import { generatedCustomTestsQuery } from "@/lib/local-queries";
import { ensureSyncedWhenIdle } from "@/lib/content-sync";

export default function CustomTestsPage() {
  const router = useRouter();
  const { authFetch, authReady } = useAuth();
  const { t, language } = useSiteLanguage();

  // Local-first: "Sozlamali testlar" ro'yxati keshlangan bilet bankidan (lib/answer-bank.ts)
  // tarmoqsiz quriladi — faqat id, nom va son. Savollarning o'zi test ochilganda har safar
  // biletlar bankidan yangi tasodifiy to'plam sifatida tanlanadi (custom/[testId]).
  const localTestsQuery = useQuery(generatedCustomTestsQuery());
  const localTests: CustomTestCard[] | null = localTestsQuery.data ?? null;

  useEffect(() => {
    if (!authReady) return;
    return ensureSyncedWhenIdle(authFetch);
  }, [authReady, authFetch]);

  const customTestsQuery = useQuery({
    queryKey: ["custom-tests", language],
    queryFn: () => fetchCustomTests(language, true),
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
  const isLoading = localTests === null || (localTests.length === 0 && customTestsQuery.isLoading);

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
        </div>
      </div>

      {isLoading ? (
        <div className="customSizeGrid" aria-busy="true" aria-label={t("custom.loading")}>
          {Array.from({ length: 12 }, (_, index) => (
            <div key={index} className="customSizeBtn skeletonShimmer" aria-hidden="true" />
          ))}
        </div>
      ) : (
        <div className="customSizeGrid">
          {items.map((customTest) => (
            <button
              key={customTest.id}
              className="customSizeBtn"
              type="button"
              onClick={() => router.push(`/app/page/custom/${customTest.id}`)}
            >
              {customTest.title}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
