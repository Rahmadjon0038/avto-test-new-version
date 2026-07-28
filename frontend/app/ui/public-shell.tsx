"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Globe, LogIn } from "lucide-react";
import { useSiteLanguage } from "@/app/site-language-provider";
import PublicAuthModal from "@/app/ui/public-auth-modal";

export default function PublicShell({ children }: { children: ReactNode }) {
  const { language, setLanguage, options, t } = useSiteLanguage();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [authOpen, setAuthOpen] = useState(false);
  const [authTab, setAuthTab] = useState<"login" | "register">("login");

  useEffect(() => {
    const auth = searchParams.get("auth");
    if (auth === "login" || auth === "register") {
      setAuthTab(auth);
      setAuthOpen(true);
      return;
    }
    setAuthOpen(false);
  }, [searchParams]);

  function openAuth(nextTab: "login" | "register" = "login") {
    setAuthTab(nextTab);
    setAuthOpen(true);
    const url = new URL(window.location.href);
    url.searchParams.set("auth", nextTab);
    router.replace(`${pathname}?${url.searchParams.toString()}`, { scroll: false });
  }

  function closeAuth() {
    setAuthOpen(false);
    const url = new URL(window.location.href);
    url.searchParams.delete("auth");
    const query = url.searchParams.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  return (
    <>
      <header className="navbar">
        <div className="navbarInner">
          <Link href="/" className="brand" style={{ textDecoration: "none" }}>
            <div className="textLogo textLogoAuth" aria-label="Topshirdi">
              <span className="textLogoRoad">Topshirdi</span>
            </div>
          </Link>
          <div className="navRight" style={{ gap: 12 }}>
            <div className="languageRow" aria-label={t("common.selectLanguage")}>
              {options.map((option) => (
                <button
                  key={option.code}
                  className={`languageChip ${language === option.code ? "active" : ""}`}
                  type="button"
                  onClick={() => setLanguage(option.code)}
                  aria-pressed={language === option.code}
                  title={option.label}
                  data-lang={option.code}
                >
                  <Globe className="lucide" aria-hidden="true" />
                  <span>{option.shortLabel}</span>
                </button>
              ))}
            </div>
            <button type="button" className="btn btn-ghost headerActionBtn" onClick={() => openAuth("login")}>
              <LogIn className="lucide" aria-hidden="true" /> {t("nav.login")}
            </button>
          </div>
        </div>
      </header>

      <main className="container">{children}</main>

      <footer className="siteFooter">
        <div className="siteFooterInner">
          <div className="siteFooterLogo">
            <span className="textLogoRoad">Topshirdi</span>
          </div>
          <div className="siteFooterLinks">
            <Link href="/biletlar" className="siteSocialLink sitePrivacyLink">
              {t("footer.tickets")}
            </Link>
            <Link href="/mavzular" className="siteSocialLink sitePrivacyLink">
              {t("footer.topics")}
            </Link>
            <a className="siteSocialLink sitePrivacyLink" href="/privacy">
              {t("footer.privacy")}
            </a>
          </div>
        </div>
      </footer>

      <PublicAuthModal open={authOpen} initialTab={authTab} onClose={closeAuth} />
    </>
  );
}
