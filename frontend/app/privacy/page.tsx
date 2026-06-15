import type { Metadata } from "next";
import {
  BadgeInfo,
  BookOpen,
  CalendarClock,
  Download,
  Mail,
  ShieldCheck,
  UserRoundCheck,
  Users,
  Globe2
} from "lucide-react";

import privacyPolicy from "@/data/privacy-policy.json";
import { getSiteUrl, siteName } from "@/lib/site";
import styles from "./page.module.css";

const siteUrl = getSiteUrl();

export const metadata: Metadata = {
  title: `${privacyPolicy.title} | ${siteName}`,
  description:
    "Road Test maxfiylik siyosati: qaysi ma'lumotlar to'planishi, ulardan foydalanish, ulashish va foydalanuvchi huquqlari.",
  alternates: {
    canonical: "/privacy"
  },
  openGraph: {
    type: "article",
    locale: "uz_UZ",
    url: "/privacy",
    siteName,
    title: `${privacyPolicy.title} | ${siteName}`,
    description:
      "Road Test maxfiylik siyosati: qaysi ma'lumotlar to'planishi, ulardan foydalanish, ulashish va foydalanuvchi huquqlari."
  },
  twitter: {
    card: "summary",
    title: `${privacyPolicy.title} | ${siteName}`,
    description:
      "Road Test maxfiylik siyosati: qaysi ma'lumotlar to'planishi, ulardan foydalanish, ulashish va foydalanuvchi huquqlari."
  },
  robots: {
    index: true,
    follow: true
  }
};

const highlightIcons = [ShieldCheck, BookOpen, UserRoundCheck];
const sectionIcons = [Users, Globe2, BadgeInfo, ShieldCheck, UserRoundCheck, CalendarClock, Mail];

export default function PrivacyPage() {
  return (
    <main className={styles.page}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "WebPage",
            name: `${privacyPolicy.title} | ${siteName}`,
            url: new URL("/privacy", siteUrl).toString(),
            description: siteDescription,
            inLanguage: "uz"
          })
        }}
      />

      <section className={styles.hero}>
        <div className={styles.heroTop}>
          <div className={styles.brandPill}>
            <ShieldCheck size={18} />
            <span>Road Test</span>
          </div>
          <a className={styles.downloadBtn} href="/privacy-policy.pdf" download>
            <Download size={18} />
            PDF yuklab olish
          </a>
        </div>

        <div className={styles.heroContent}>
          <div className={styles.heroCopy}>
            <p className={styles.kicker}>Rasmiy hujjat</p>
            <h1>{privacyPolicy.title}</h1>
            <p className={styles.lead}>
              Road Test foydalanuvchi ma'lumotlarini qanday yig‘ishi, saqlashi va himoya qilishini ochiq tushuntiradi.
            </p>
            <div className={styles.metaRow}>
              <span className={styles.metaChip}>
                <CalendarClock size={16} />
                Oxirgi yangilanish: {privacyPolicy.lastUpdatedLabel}
              </span>
              <span className={styles.metaChip}>
                <ShieldCheck size={16} />
                Bepul platforma
              </span>
            </div>
          </div>

          <div className={styles.heroPanel}>
            <div className={styles.heroPanelIcon}>
              <ShieldCheck size={26} />
            </div>
            <div className={styles.heroPanelTitle}>Maxfiylik va xavfsizlik</div>
            <p>
              Platforma bepul ishlaydi, reklama va to‘lov tizimi yo‘q. Ma'lumotlar faqat ta'limiy xizmatni taqdim etish
              uchun ishlatiladi.
            </p>
          </div>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <div>
            <p className={styles.sectionLabel}>Qisqacha</p>
            <h2>Asosiy tamoyillar</h2>
          </div>
        </div>

        <div className={styles.highlightGrid}>
          {privacyPolicy.highlights.map((item, index) => {
            const Icon = highlightIcons[index] ?? ShieldCheck;
            return (
              <article key={item.title} className={styles.highlightCard}>
                <div className={styles.highlightIcon}>
                  <Icon size={18} />
                </div>
                <div>
                  <h3>{item.title}</h3>
                  <p>{item.text}</p>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <div>
            <p className={styles.sectionLabel}>Batafsil</p>
            <h2>Maxfiylik siyosati bo‘limlari</h2>
          </div>
        </div>

        <div className={styles.policyGrid}>
          {privacyPolicy.sections.map((section, index) => {
            const Icon = sectionIcons[index] ?? BadgeInfo;
            return (
              <article key={section.title} className={styles.policyCard}>
                <div className={styles.policyHead}>
                  <div className={styles.policyIcon}>
                    <Icon size={18} />
                  </div>
                  <h3>{section.title}</h3>
                </div>
                <ul className={styles.policyList}>
                  {section.items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </article>
            );
          })}
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <div>
            <p className={styles.sectionLabel}>Aloqa</p>
            <h2>Biz bilan bog‘lanish</h2>
          </div>
        </div>

        <div className={styles.contactCard}>
          <a href={`mailto:${privacyPolicy.contact.email}`} className={styles.contactLink}>
            <Mail size={18} />
            {privacyPolicy.contact.email}
          </a>
          <a href={privacyPolicy.contact.website} className={styles.contactLink} target="_blank" rel="noreferrer">
            <Globe2 size={18} />
            {privacyPolicy.contact.website}
          </a>
        </div>
      </section>
    </main>
  );
}
