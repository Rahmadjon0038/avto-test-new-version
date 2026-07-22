import type { ReactNode } from "react";
import Link from "next/link";
import { Globe, LogIn } from "lucide-react";
import { useSiteLanguage } from "@/app/site-language-provider";

export default function PublicShell({ children }: { children: ReactNode }) {
  const { language, setLanguage, options, t } = useSiteLanguage();
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
                >
                  <Globe className="lucide" aria-hidden="true" />
                  <span>{option.shortLabel}</span>
                </button>
              ))}
            </div>
            <Link href="/?auth=login" className="btn btn-ghost headerActionBtn">
              <LogIn className="lucide" aria-hidden="true" /> {t("nav.login")}
            </Link>
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
    </>
  );
}
