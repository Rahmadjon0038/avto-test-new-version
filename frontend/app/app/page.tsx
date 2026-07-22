"use client";

import { BookOpen, CheckCheck, Flame, LayoutGrid, SlidersHorizontal, Tickets, X, Video } from "lucide-react";
import { useRouter } from "next/navigation";
import { useSiteLanguage } from "@/app/site-language-provider";

function MenuItem({
  icon,
  title,
  desc,
  href,
  page,
  badge,
  comingSoon = false
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
  href: string;
  page: string;
  badge?: string;
  comingSoon?: boolean;
}) {
  const router = useRouter();
  return (
    <button className={`menuItem ${comingSoon ? "menuItemSoon" : ""}`} data-page={page} type="button" onClick={() => !comingSoon && router.push(href)} disabled={comingSoon}>
      <span className="miIcon">{icon}</span>
      <span className="miMain">
        <span className="miTextRow">
          <span className="miText">{title}</span>
          {badge ? <span className="soonBadge">{badge}</span> : null}
        </span>
        <span className="miDesc">{desc}</span>
      </span>
      <span className="miChevron">›</span>
    </button>
  );
}

export default function AppHome() {
  const { t } = useSiteLanguage();
  return (
    <section className="view">
      <div className="homeHero card">
        <div className="homeTitle">{t("home.hero")}</div>
      </div>

      <div className="homeMenu">
        <MenuItem page="topics" icon={<LayoutGrid className="lucide" />} title={t("home.topicsTitle")} desc={t("home.topicsDesc")} href="/app/page/topics" />
        <MenuItem page="tickets" icon={<Tickets className="lucide" />} title={t("home.ticketsTitle")} desc={t("home.ticketsDesc")} href="/app/tickets" />
        <MenuItem page="custom" icon={<SlidersHorizontal className="lucide" />} title={t("home.customTitle")} desc={t("home.customDesc")} href="/app/page/custom" />
        <MenuItem page="mistakes" icon={<X className="lucide" />} title={t("home.mistakesTitle")} desc={t("home.mistakesDesc")} href="/app/page/mistakes" />
        <MenuItem page="answers" icon={<BookOpen className="lucide" />} title={t("home.answersTitle")} desc={t("home.answersDesc")} href="/app/page/answers" />
        <MenuItem page="exam" icon={<CheckCheck className="lucide" />} title={t("home.examTitle")} desc={t("home.examDesc")} href="/app/page/exam" />
      </div>

      <div className="homeSoonBlock">
        <div className="homeMenu homeMenuSoon">
        <MenuItem
            page="marathon"
            icon={<Flame className="lucide" />}
            title={t("home.marathonTitle")}
            desc={t("home.marathonDesc")}
            href="/app/page/marathon"
            comingSoon={false}
          />
          <MenuItem
            page="videos"
            icon={<Video className="lucide" />}
            title={t("home.videosTitle")}
            desc={t("home.videosDesc")}
            href="/app/page/videos"
            comingSoon={false}
          />
        </div>
      </div>
    </section>
  );
}
