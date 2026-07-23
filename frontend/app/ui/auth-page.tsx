"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import {
  ArrowRight,
  BookOpen,
  CheckCheck,
  Eye,
  EyeOff,
  Flame,
  KeyRound,
  LayoutGrid,
  PlayCircle,
  SlidersHorizontal,
  Send,
  Tickets,
  Video,
  X
} from "lucide-react";
import Link from "next/link";
import { useMutation } from "@tanstack/react-query";
import { useAuth } from "@/app/auth-provider";
import { useSiteLanguage } from "@/app/site-language-provider";
import { jsonOrError } from "@/lib/api-authed";

type Tab = "register" | "login";

declare global {
  interface Window {
    google?: any;
  }
}

const GOOGLE_WEB_CLIENT_ID = "844953821020-2dcgvd7i32rvpj552gkgopat9278tnfe.apps.googleusercontent.com";

function formatUzLocalPhone(value: string) {
  const digits = normalizeUzLocalDigits(value);
  const p1 = digits.slice(0, 2);
  const p2 = digits.slice(2, 5);
  const p3 = digits.slice(5, 7);
  const p4 = digits.slice(7, 9);
  const parts = [];
  if (p1) parts.push(p1);
  if (p2) parts.push(p2);
  if (p3) parts.push(p3);
  if (p4) parts.push(p4);
  return parts.join("-");
}

function uzLocalDigits(value: string) {
  return normalizeUzLocalDigits(value);
}

function normalizeUzLocalDigits(value: string) {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return "";
  const local = digits.startsWith("998") ? digits.slice(3) : digits;
  return local.slice(0, 9);
}

function InstagramMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect x="3.5" y="3.5" width="17" height="17" rx="5" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="17.1" cy="6.9" r="1.2" fill="currentColor" />
    </svg>
  );
}

function LandingMenuItem({
  icon,
  title,
  desc,
  page,
  href,
  onSelect
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
  page: string;
  href?: string;
  onSelect?: () => void;
}) {
  const inner = (
    <>
      <span className="miIcon">{icon}</span>
      <span className="miMain">
        <span className="miTextRow">
          <span className="miText">{title}</span>
        </span>
        <span className="miDesc">{desc}</span>
      </span>
      <span className="miChevron">›</span>
    </>
  );

  if (href) {
    return (
      <Link className="menuItem" data-page={page} href={href}>
        {inner}
      </Link>
    );
  }

  return (
    <button className="menuItem" data-page={page} type="button" onClick={onSelect}>
      {inner}
    </button>
  );
}

export default function AuthPage() {
  const router = useRouter();
  const { setAccessToken, setUser, authReady, accessToken } = useAuth();
  const { t } = useSiteLanguage();
  const [tab, setTab] = useState<Tab>("login");
  const [authOpen, setAuthOpen] = useState(false);
  const [pendingRedirect, setPendingRedirect] = useState("");
  const [phoneRegisterLocal, setPhoneRegisterLocal] = useState("");
  const [passwordRegister, setPasswordRegister] = useState("");
  const [phoneLoginLocal, setPhoneLoginLocal] = useState("");
  const [passwordLogin, setPasswordLogin] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [forgotOpen, setForgotOpen] = useState(false);
  const googleButtonRef = useRef<HTMLDivElement | null>(null);
  const googleButtonLoadedRef = useRef(false);

  useEffect(() => {
    if (authReady && accessToken) router.replace("/app");
  }, [authReady, accessToken, router]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const auth = params.get("auth");
    if (auth === "login" || auth === "register") {
      openAuth(auth);
      const url = new URL(window.location.href);
      url.searchParams.delete("auth");
      window.history.replaceState({}, "", url.pathname + url.search);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    document.body.style.overflow = authOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [authOpen]);

  useEffect(() => {
    if (!authOpen) return;
    if (googleButtonLoadedRef.current) {
      const google = window.google;
      if (google?.accounts?.id && googleButtonRef.current) {
        googleButtonRef.current.innerHTML = "";
        google.accounts.id.renderButton(googleButtonRef.current, {
          theme: "outline",
          size: "large",
          width: googleButtonRef.current.offsetWidth || 360,
          text: "signin_with",
          shape: "pill"
        });
      }
      return;
    }

    const scriptId = "google-gsi-script";
    const existingScript = document.getElementById(scriptId) as HTMLScriptElement | null;
    const initGoogle = () => {
      const google = window.google;
      if (!google?.accounts?.id || !googleButtonRef.current) return;
      googleButtonRef.current.innerHTML = "";
      google.accounts.id.initialize({
        client_id: GOOGLE_WEB_CLIENT_ID,
        callback: async (response: { credential?: string }) => {
          const credential = String(response?.credential || "");
          if (!credential) {
            toast.error(t("auth.googleTokenMissing"));
            return;
          }
          try {
            const data = await fetch("/api/auth/google", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ idToken: credential })
            }).then(jsonOrError);
            if (data?.accessToken) setAccessToken(String(data.accessToken));
            if (data?.user) setUser(data.user);
            toast.success(t("auth.googleLoginSuccess"));
            setAuthOpen(false);
            router.push("/app");
          } catch (error: any) {
            toast.error(error?.message || t("auth.googleLoginFailed"));
          }
        }
      });
      google.accounts.id.renderButton(googleButtonRef.current, {
        theme: "outline",
        size: "large",
        width: googleButtonRef.current.offsetWidth || 360,
        text: "signin_with",
        shape: "pill"
      });
      googleButtonLoadedRef.current = true;
    };

    if (window.google?.accounts?.id) {
      initGoogle();
      return;
    }

    const script = existingScript || document.createElement("script");
    if (!existingScript) {
      script.id = scriptId;
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      script.defer = true;
      script.onload = initGoogle;
      document.head.appendChild(script);
    } else {
      existingScript.addEventListener("load", initGoogle, { once: true });
      initGoogle();
    }
  }, [authOpen, router, setAccessToken, setUser]);

  function switchTab(nextTab: Tab) {
    toast.dismiss();
    setTab(nextTab);
  }

  function openAuth(nextTab: Tab = "login") {
    setTab(nextTab);
    setAuthOpen(true);
    setForgotOpen(false);
  }

  function openAuthWithRedirect(nextTab: Tab = "login", redirectTo = "") {
    setPendingRedirect(redirectTo);
    openAuth(nextTab);
  }

  function closeAuth() {
    setAuthOpen(false);
  }

  const registerMutation = useMutation({
    mutationFn: (payload: { phone: string; password: string }) =>
      fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      }).then(jsonOrError),
    onSuccess: (_data: any, variables) => {
      const localPhone = String(variables.phone || "").replace(/\D/g, "").slice(-9);
      setPhoneRegisterLocal(localPhone);
      setPhoneLoginLocal(localPhone);
      setPasswordRegister("");
      setPasswordLogin("");
      setTab("login");
      toast.success(t("auth.registerSuccess"));
    },
    onError: (e: any, variables) => {
      const message = String(e?.message || "Xatolik");
      if (message.toLowerCase().includes("allaqachon")) {
        const localPhone = String(variables.phone || "").replace(/\D/g, "").slice(-9);
        setPhoneRegisterLocal(localPhone);
        setPhoneLoginLocal(localPhone);
        setPasswordRegister("");
        setPasswordLogin("");
        setTab("login");
        toast.error(t("auth.alreadyRegistered"));
        return;
      }
      toast.error(message);
    }
  });

  async function onRegister(e: React.FormEvent) {
    e.preventDefault();
    const form = e.currentTarget as HTMLFormElement;
    const formData = new FormData(form);
    const rawPhone = String(formData.get("phone") || phoneRegisterLocal);
    const rawPassword = String(formData.get("password") || passwordRegister);
    const phoneDigits = uzLocalDigits(rawPhone);

    if (phoneDigits.length !== 9) return toast.error(t("auth.phoneFormatInvalid"));
    if (rawPassword.length < 6) return toast.error(t("auth.passwordTooShort"));

    registerMutation.mutate({
      phone: `+998${phoneDigits}`,
      password: rawPassword
    });
  }

  const loginMutation = useMutation({
    mutationFn: (payload: { phone: string; password: string }) =>
      fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      }).then(jsonOrError),
    onSuccess: (data: any) => {
      if (data?.accessToken) setAccessToken(String(data.accessToken));
      if (data?.user) setUser(data.user);
      toast.success(t("auth.loginSuccess"));
      router.push(pendingRedirect || "/app");
      setPendingRedirect("");
    },
    onError: (e: any) => toast.error(e?.message || t("common.error"))
  });

  function forgotTelegramUrl() {
    const phoneDigits = uzLocalDigits(phoneLoginLocal);
    const phone = phoneDigits.length === 9 ? `+998${phoneDigits}` : "";
    const text = `Salom, men Topshirdi ilovasida parolimni unutdim. Telefon raqamim: ${phone}`;
    // Admin username: @Rahmadjonn (strip leading @ for t.me link)
    const adminUsername = String("Rahmadjonn").replace(/^@/, "");
    return `https://t.me/${encodeURIComponent(adminUsername)}?text=${encodeURIComponent(text)}`;
  }

  function openForgotTelegram() {
    window.open(forgotTelegramUrl(), "_blank", "noopener,noreferrer");
  }

  async function onLogin(e: React.FormEvent) {
    e.preventDefault();
    const form = e.currentTarget as HTMLFormElement;
    const formData = new FormData(form);
    const rawPhone = String(formData.get("phone") || phoneLoginLocal);
    const rawPassword = String(formData.get("password") || passwordLogin);
    const phoneDigits = uzLocalDigits(rawPhone);

    if (phoneDigits.length !== 9) return toast.error(t("auth.phoneFormatInvalid"));
    if (!rawPassword) return toast.error(t("auth.passwordRequired"));

    loginMutation.mutate({ phone: `+998${phoneDigits}`, password: rawPassword });
  }

  return (
    <>
      <header className="navbar">
        <div className="navbarInner">
          <div className="brand">
            <div className="textLogo textLogoAuth" aria-label="Topshirdi">
              <span className="textLogoRoad">Topshirdi</span>
            </div>
          </div>
          <div className="navRight">
            <button className="btn btn-ghost headerActionBtn" type="button" onClick={() => openAuth()}>
              <ArrowRight className="lucide" aria-hidden="true" />
              {t("nav.login")}
            </button>
          </div>
        </div>
      </header>

      <main className="container authContainer">
        <div className="landingLayout">
          <section className="landingHero">
            <div className="heroGrid">
              <div className="heroCopy">
                <h1 className="landingTitle">
                  <span className="landingLine">{t("auth.heroTitle")}</span>
                </h1>
                <p className="landingLead">{t("auth.heroText")}</p>

                <div className="landingCtaRow">
                  <button className="btn btn-primary landingStartBtn" type="button" onClick={() => openAuth()}>
                    {t("auth.enterTests")}
                  </button>
                  <button className="btn btn-ghost landingVideoBtn" type="button" onClick={() => openAuthWithRedirect("login", "/app/page/videos")}>
                    <PlayCircle className="lucide" aria-hidden="true" />
                    {t("home.videosTitle")}
                  </button>
                </div>
              </div>
            </div>

            <section className="landingMenuSection">
              <div className="homeHero card">
                <div className="homeTitle">{t("home.hero")}</div>
              </div>

              <div className="homeMenu">
                <LandingMenuItem
                  page="topics"
                  icon={<LayoutGrid className="lucide" />}
                  title={t("home.topicsTitle")}
                  desc={t("home.topicsDesc")}
                  href="/mavzular"
                />
                <LandingMenuItem
                  page="tickets"
                  icon={<Tickets className="lucide" />}
                  title={t("home.ticketsTitle")}
                  desc={t("home.ticketsDesc")}
                  href="/biletlar"
                />
                <LandingMenuItem
                  page="custom"
                  icon={<SlidersHorizontal className="lucide" />}
                  title={t("home.customTitle")}
                  desc={t("home.customDesc")}
                  onSelect={() => openAuth()}
                />
                <LandingMenuItem
                  page="mistakes"
                  icon={<X className="lucide" />}
                  title={t("home.mistakesTitle")}
                  desc={t("home.mistakesDesc")}
                  onSelect={() => openAuth()}
                />
                <LandingMenuItem
                  page="answers"
                  icon={<BookOpen className="lucide" />}
                  title={t("home.answersTitle")}
                  desc={t("home.answersDesc")}
                  onSelect={() => openAuth()}
                />
                <LandingMenuItem
                  page="exam"
                  icon={<CheckCheck className="lucide" />}
                  title={t("home.examTitle")}
                  desc={t("home.examDesc")}
                  onSelect={() => openAuth()}
                />
              </div>

              <div className="homeSoonBlock">
                <div className="homeMenu homeMenuSoon">
                  <LandingMenuItem
                    page="marathon"
                    icon={<Flame className="lucide" />}
                    title={t("home.marathonTitle")}
                    desc={t("home.marathonDesc")}
                    onSelect={() => openAuth()}
                  />
                  <LandingMenuItem
                    page="videos"
                    icon={<Video className="lucide" />}
                    title={t("home.videosTitle")}
                    desc={t("home.videosDesc")}
                    onSelect={() => openAuthWithRedirect("login", "/app/page/videos")}
                  />
                </div>
              </div>
            </section>
          </section>
        </div>
      </main>

      <footer className="siteFooter">
        <div className="siteFooterInner">
          <div className="siteFooterLogo">
            <span className="textLogoRoad">Topshirdi</span>
          </div>
          <div className="siteFooterLinks" aria-label="Social links">
            <a className="siteSocialLink" href="#" aria-label={t("social.instagram")} title={t("social.instagram")}>
              <InstagramMark />
              <span className="siteSocialLinkText">{t("social.instagram")}</span>
            </a>
            <a className="siteSocialLink" href="#" aria-label={t("social.telegram")} title={t("social.telegram")}>
              <Send className="lucide" aria-hidden="true" />
              <span className="siteSocialLinkText">{t("social.telegram")}</span>
            </a>
          </div>
        </div>
      </footer>

      {authOpen ? (
        <div className="authModalOverlay" role="presentation" onClick={closeAuth}>
          <div className="authModal" role="dialog" aria-modal="true" aria-labelledby="auth-modal-title" onClick={(event) => event.stopPropagation()}>
            <div className="authModalHeader">
              <div className="authModalTitleWrap">
                <div className="authModalTitle" id="auth-modal-title">
                  {tab === "login" ? t("auth.loginTitle") : t("auth.registerTitle")}
                </div>
              </div>
              <button className="btn btn-ghost" type="button" onClick={closeAuth}>
                ✕
              </button>
            </div>

            <div className="authTabs" role="tablist" aria-label="Auth tabs">
              <button type="button" className={`authTab ${tab === "login" ? "active" : ""}`} onClick={() => switchTab("login")} aria-pressed={tab === "login"}>
                {t("auth.loginTitle")}
              </button>
              <button type="button" className={`authTab ${tab === "register" ? "active" : ""}`} onClick={() => switchTab("register")} aria-pressed={tab === "register"}>
                {t("auth.registerTitle")}
              </button>
            </div>

            {tab === "register" ? (
              <form className="formGrid authForm" onSubmit={onRegister}>
                <div>
                  <div className="fieldLabel">{t("auth.phone")}</div>
                  <div className="inputGroup authInputGroup inputPhone noRight">
                    <span className="inputAddon inputAddonText">+998</span>
                    <input
                      name="phone"
                      className="input inputField"
                      placeholder="90-123-45-67"
                      autoComplete="tel"
                      inputMode="tel"
                      value={formatUzLocalPhone(phoneRegisterLocal)}
                      onChange={(e) => setPhoneRegisterLocal(uzLocalDigits(e.target.value))}
                    />
                  </div>
                </div>

                <div>
                  <div className="fieldLabel">{t("auth.password")}</div>
                  <div className="inputGroup authInputGroup">
                    <span className="inputAddon">
                      <KeyRound className="lucide" aria-hidden="true" />
                    </span>
                    <input
                      name="password"
                      className="input inputField"
                      type={showPass ? "text" : "password"}
                      placeholder={t("auth.passwordTooShort")}
                      autoComplete="new-password"
                      value={passwordRegister}
                      onChange={(e) => setPasswordRegister(e.target.value)}
                    />
                    <button className="inputIconBtn" type="button" onClick={() => setShowPass((v) => !v)} aria-label={showPass ? t("profile.hidePassword") : t("profile.showPassword")}>
                      {showPass ? <EyeOff className="lucide" aria-hidden="true" /> : <Eye className="lucide" aria-hidden="true" />}
                    </button>
                  </div>
                </div>
                <button className="btn btn-primary authSubmitBtn" type="submit" disabled={registerMutation.isPending}>
                  {t("auth.registerTitle")}
                </button>
                <p className="authPrivacyNote">
                  {t("auth.registerAgreementPrefix")}
                  <Link href="/privacy" className="authPrivacyLink">
                    {t("footer.privacy")}
                  </Link>{" "}
                  {t("auth.registerAgreementSuffix")}
                </p>
              </form>
            ) : (
              <form className="formGrid authForm" onSubmit={onLogin}>
                <div>
                  <div className="fieldLabel">{t("auth.phone")}</div>
                  <div className="inputGroup authInputGroup inputPhone noRight">
                    <span className="inputAddon inputAddonText">+998</span>
                    <input
                      name="phone"
                      className="input inputField"
                      placeholder="91-234-56-78"
                      autoComplete="tel"
                      inputMode="tel"
                      value={formatUzLocalPhone(phoneLoginLocal)}
                      onChange={(e) => setPhoneLoginLocal(uzLocalDigits(e.target.value))}
                    />
                  </div>
                </div>

                <div>
                  <div className="fieldLabel">{t("auth.password")}</div>
                  <div className="inputGroup authInputGroup">
                    <span className="inputAddon">
                      <KeyRound className="lucide" aria-hidden="true" />
                    </span>
                    <input
                      name="password"
                      className="input inputField"
                      type={showPass ? "text" : "password"}
                      placeholder={t("auth.password")}
                      autoComplete="current-password"
                      value={passwordLogin}
                      onChange={(e) => setPasswordLogin(e.target.value)}
                    />
                    <button className="inputIconBtn" type="button" onClick={() => setShowPass((v) => !v)} aria-label={showPass ? t("profile.hidePassword") : t("profile.showPassword")}>
                      {showPass ? <EyeOff className="lucide" aria-hidden="true" /> : <Eye className="lucide" aria-hidden="true" />}
                    </button>
                  </div>
                </div>
                <button className="btn btn-primary authSubmitBtn" type="submit" disabled={loginMutation.isPending}>
                  {t("auth.loginButton")}
                </button>
                <button className="authForgotBtn" type="button" onClick={() => setForgotOpen(true)}>
                  {t("auth.forgotPassword")}
                </button>
              </form>
            )}

            <div className="authGoogleBlock">
              <div className="authDivider">
                <span>{t("auth.orGoogle")}</span>
              </div>
              <div className="googleButtonMount" ref={googleButtonRef} />
            </div>
          </div>
        </div>
      ) : null}
      {forgotOpen ? (
        <div className="authModalOverlay authForgotOverlay" role="presentation" onClick={() => setForgotOpen(false)}>
          <div className="authForgotModal" role="dialog" aria-modal="true" aria-labelledby="forgot-password-title" onClick={(event) => event.stopPropagation()}>
            <div className="authModalHeader">
              <div className="authModalTitleWrap">
                <div className="authModalTitle" id="forgot-password-title">
                  {t("auth.forgotTitle")}
                </div>
              </div>
              <button className="btn btn-ghost" type="button" onClick={() => setForgotOpen(false)}>
                ✕
              </button>
            </div>
            <p className="authForgotText">{t("auth.forgotText")}</p>
            <button className="authTelegramBtn" type="button" onClick={openForgotTelegram}>
              <Send className="lucide" aria-hidden="true" />
              {t("auth.forgotTelegram")}
            </button>
            <div className="authResetNotice">
              <div className="authResetTitle">{t("auth.forgotNoteTitle")}</div>
              <div className="authResetText">{t("auth.forgotNoteText")}</div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
