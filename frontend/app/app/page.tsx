"use client";

import { BookOpen, CheckCheck, Flame, LayoutGrid, SlidersHorizontal, Tickets, X } from "lucide-react";
import { useRouter } from "next/navigation";

function MenuItem({
  icon,
  title,
  desc,
  href,
  page
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
  href: string;
  page: string;
}) {
  const router = useRouter();
  return (
    <button className="menuItem" data-page={page} type="button" onClick={() => router.push(href)}>
      <span className="miIcon">{icon}</span>
      <span className="miMain">
        <span className="miText">{title}</span>
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
        <MenuItem page="marathon" icon={<Flame className="lucide" />} title="Marafon rejimi" desc="Uzluksiz savollar: tezlik va aniqlikni oshiring." href="/app/page/marathon" />
        <MenuItem page="answers" icon={<BookOpen className="lucide" />} title="Barcha testlar javoblari" desc="To‘g‘ri javoblarni izohlar bilan ko‘ring." href="/app/page/answers" />
        <MenuItem page="exam" icon={<CheckCheck className="lucide" />} title="Imtihon topshirish" desc="Haqiqiy imtihondek sinovdan o‘ting." href="/app/page/exam" />
      </div>
    </section>
  );
}
