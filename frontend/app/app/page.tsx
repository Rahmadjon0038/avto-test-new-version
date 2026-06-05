"use client";

import { BookOpen, CheckCheck, Flame, LayoutGrid, SlidersHorizontal, Tickets, X, Video } from "lucide-react";
import { useRouter } from "next/navigation";

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
  return (
    <section className="view">
      <div className="homeHero card">
        <div className="homeTitle">Prava olish endi biz bilan oson!</div>
      </div>

      <div className="homeMenu">
        <MenuItem page="topics" icon={<LayoutGrid className="lucide" />} title="Mavzu bo‘yicha testlar" desc="Belgilar va qoidalarni bo‘limma-bo‘lim o‘rganing." href="/app/page/topics" />
        <MenuItem page="tickets" icon={<Tickets className="lucide" />} title="Biletlar bo‘yicha testlar" desc="Rasmiy biletlar formatida yechib mashq qiling." href="/app/tickets" />
        <MenuItem page="custom" icon={<SlidersHorizontal className="lucide" />} title="Sozlamali testlar" desc="Savol soni va rejimni o‘zingiz tanlang." href="/app/page/custom" />
        <MenuItem page="mistakes" icon={<X className="lucide" />} title="Mening xatolarim" desc="Xato qilgan savollaringizni qayta ko‘rib chiqing." href="/app/page/mistakes" />
        <MenuItem page="answers" icon={<BookOpen className="lucide" />} title="Barcha testlar javoblari" desc="To‘g‘ri javoblarni izohlar bilan ko‘ring." href="/app/page/answers" />
        <MenuItem page="exam" icon={<CheckCheck className="lucide" />} title="Imtihon topshirish" desc="Haqiqiy imtihondek sinovdan o‘ting." href="/app/page/exam" />
      </div>

      <div className="homeSoonBlock">
        <div className="homeMenu homeMenuSoon">
          <MenuItem
            page="marathon"
            icon={<Flame className="lucide" />}
            title="Marafon rejimi"
            desc="Uzluksiz savollar: tezlik va aniqlikni oshiring."
            href="/app/page/marathon"
            badge="Tez kunda"
            comingSoon
          />
          <MenuItem
            page="videos"
            icon={<Video className="lucide" />}
            title="Video darsliklar"
            desc="Mavzulashtirilgan video darsliklar."
            href="/app/page/videos"
            badge="Tez kunda"
            comingSoon
          />
        </div>
      </div>
    </section>
  );
}
