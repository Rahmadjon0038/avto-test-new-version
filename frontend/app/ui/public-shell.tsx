import type { ReactNode } from "react";
import Link from "next/link";

export default function PublicShell({ children }: { children: ReactNode }) {
  return (
    <>
      <header className="navbar">
        <div className="navbarInner">
          <Link href="/" className="brand" style={{ textDecoration: "none" }}>
            <div className="textLogo textLogoAuth" aria-label="Topshirdi">
              <span className="textLogoRoad">Topshirdi</span>
            </div>
          </Link>
          <div className="navRight">
            <Link href="/?auth=login" className="btn btn-ghost headerActionBtn">
              Tizimga kirish
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
              Biletlar
            </Link>
            <Link href="/mavzular" className="siteSocialLink sitePrivacyLink">
              Mavzular
            </Link>
            <a className="siteSocialLink sitePrivacyLink" href="/privacy">
              Privacy
            </a>
          </div>
        </div>
      </footer>
    </>
  );
}
