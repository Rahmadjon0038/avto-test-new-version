"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import {
  ArrowRight,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  PlayCircle,
  ShieldCheck,
  Send,
  UserPlus,
  UserRound,
  Video
} from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { useAuth } from "@/app/auth-provider";
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

export default function AuthPage() {
  const router = useRouter();
  const { setAccessToken, setUser, authReady, accessToken } = useAuth();
  const [tab, setTab] = useState<Tab>("login");
  const [authOpen, setAuthOpen] = useState(false);
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [fullName, setFullName] = useState("");
  const [phoneRegisterLocal, setPhoneRegisterLocal] = useState("");
  const [passwordRegister, setPasswordRegister] = useState("");
  const [phoneLoginLocal, setPhoneLoginLocal] = useState("");
  const [passwordLogin, setPasswordLogin] = useState("");
  const [forgotEmail, setForgotEmail] = useState("");
  const [showPass, setShowPass] = useState(false);
  const googleButtonRef = useRef<HTMLDivElement | null>(null);
  const googleButtonLoadedRef = useRef(false);

  useEffect(() => {
    if (authReady && accessToken) router.replace("/app");
  }, [authReady, accessToken, router]);

  useEffect(() => {
    document.body.style.overflow = authOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [authOpen]);

  useEffect(() => {
    if (!authOpen || showForgotPassword) return;
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
            toast.error("Google token topilmadi");
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
            toast.success("Google orqali kirildi");
            setAuthOpen(false);
            router.push("/app");
          } catch (error: any) {
            toast.error(error?.message || "Google orqali kirish amalga oshmadi");
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
  }, [authOpen, router, setAccessToken, setUser, showForgotPassword]);

  function switchTab(nextTab: Tab) {
    toast.dismiss();
    setTab(nextTab);
    setShowForgotPassword(false);
  }

  function openAuth(nextTab: Tab = "login") {
    setTab(nextTab);
    setShowForgotPassword(false);
    setAuthOpen(true);
  }

  function closeAuth() {
    setAuthOpen(false);
    setShowForgotPassword(false);
  }

  function scrollToVideo() {
    document.getElementById("video-lessons")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const registerMutation = useMutation({
    mutationFn: (payload: { fullName: string; phone: string; password: string }) =>
      fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      }).then(jsonOrError),
    onSuccess: (data: any) => {
      if (data?.accessToken) setAccessToken(String(data.accessToken));
      if (data?.user) setUser(data.user);
      toast.success("Ro‘yxatdan o‘tildi");
      router.push("/app");
    },
    onError: (e: any) => toast.error(e?.message || "Xatolik")
  });

  async function onRegister(e: React.FormEvent) {
    e.preventDefault();
    const form = e.currentTarget as HTMLFormElement;
    const formData = new FormData(form);
    const rawFullName = String(formData.get("fullName") || fullName);
    const rawPhone = String(formData.get("phone") || phoneRegisterLocal);
    const rawPassword = String(formData.get("password") || passwordRegister);
    const phoneDigits = uzLocalDigits(rawPhone);

    if (!rawFullName.trim()) return toast.error("Ism kiritilishi kerak");
    if (phoneDigits.length !== 9) return toast.error("Telefon raqam formati noto‘g‘ri");
    if (rawPassword.length < 6) return toast.error("Kamida 6 ta belgidan iborat parol yarating");

    registerMutation.mutate({
      fullName: rawFullName.trim(),
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
      toast.success("Kirish muvaffaqiyatli");
      router.push("/app");
    },
    onError: (e: any) => toast.error(e?.message || "Xatolik")
  });

  const resetPasswordMutation = useMutation({
    mutationFn: (payload: { email: string }) =>
      fetch("/api/auth/password-reset/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      }).then(jsonOrError),
    onSuccess: (data: any) => {
      toast.success(String(data?.message || "6 xonali kod emailingizga yuborildi"));
      setShowForgotPassword(false);
      setForgotEmail("");
      setTab("login");
    },
    onError: (e: any) => toast.error(e?.message || "Xatolik")
  });

  async function onLogin(e: React.FormEvent) {
    e.preventDefault();
    const form = e.currentTarget as HTMLFormElement;
    const formData = new FormData(form);
    const rawPhone = String(formData.get("phone") || phoneLoginLocal);
    const rawPassword = String(formData.get("password") || passwordLogin);
    const phoneDigits = uzLocalDigits(rawPhone);

    if (phoneDigits.length !== 9) return toast.error("Telefon raqam formati noto‘g‘ri");
    if (!rawPassword) return toast.error("Parolni kiriting");

    loginMutation.mutate({ phone: `+998${phoneDigits}`, password: rawPassword });
  }

  async function onForgotPassword(e: React.FormEvent) {
    e.preventDefault();
    const form = e.currentTarget as HTMLFormElement;
    const email = String(new FormData(form).get("email") || forgotEmail).trim();
    if (!email) return toast.error("Email kiritilishi kerak");
    resetPasswordMutation.mutate({ email });
  }

  return (
    <>
      <header className="navbar">
        <div className="navbarInner">
          <div className="brand">
            <div className="textLogo textLogoAuth" aria-label="ROAD TEST">
              <span className="textLogoRoad">ROAD</span>
              <span className="textLogoTest">TEST</span>
            </div>
          </div>
          <div className="navRight">
            <button className="btn btn-ghost headerActionBtn" type="button" onClick={() => openAuth("login")}>
              <ArrowRight className="lucide" aria-hidden="true" />
              Tizimga kirish
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
                  <span className="landingLine">Haydovchilikka</span>
                  <span className="landingLine">tayyorlanish uchun tezkor</span>
                  <span className="landingLine">
                    va <span className="landingAccent">qulay</span> platforma.
                  </span>
                </h1>
                <p className="landingLead">
                  Mavzular, biletlar, xatolarni ko‘rish, imtihon rejimi va video darslar bir joyda.
                </p>

                <div className="landingCtaRow">
                  <button className="btn btn-primary landingStartBtn" type="button" onClick={() => openAuth("login")}>
                    Boshlash
                  </button>
                  <button className="btn btn-ghost landingVideoBtn" type="button" onClick={() => openAuth("login")}>
                    <PlayCircle className="lucide" aria-hidden="true" />
                    Video darslar
                  </button>
                </div>
              </div>
            </div>

            <div className="landingStats">
              <div className="landingStat">
                <ShieldCheck className="lucide" aria-hidden="true" />
                <span>Mavzu bo‘yicha testlar</span>
              </div>
              <div className="landingStat">
                <CheckCircle2 className="lucide" aria-hidden="true" />
                <span>Biletlar rejimi</span>
              </div>
              <div className="landingStat">
                <Video className="lucide" aria-hidden="true" />
                <span>Video darslar</span>
              </div>
            </div>

            <div className="featureGrid">
              <article className="featureCard">
                <div className="featureTitle">Nima beradi?</div>
                <div className="featureText">Savollarni bo‘limlarga ajratib ishlaysiz, xatolaringizni ko‘rasiz va imtihon uslubida tayyorlanasiz.</div>
              </article>
              <article className="featureCard">
                <div className="featureTitle">Qulayliklar</div>
                <div className="featureText">Tez kirish, sodda interfeys, telefon orqali qulay foydalanish va bir joydagi barcha darslar.</div>
              </article>
              <article className="featureCard">
                <div className="featureTitle">Kimlar uchun?</div>
                <div className="featureText">Haydovchilikka tayyorlanayotganlar, bilet ishlayotganlar va imtihonga shug‘ullanayotganlar uchun.</div>
              </article>
            </div>

            <section className="videoSection" id="video-lessons">
              <div className="sectionHead">
                <div>
                  <h2 className="sectionTitle">Mavzulashtirilgan video darslar</h2>
                </div>
                <button className="btn btn-ghost sectionAction" type="button" onClick={() => openAuth("login")}>Barchasini ko‘rish <ArrowRight className="lucide" aria-hidden="true" /></button>
              </div>
              <div className="videoCard">
                <div className="videoCardIcon">
                  <Video className="lucide" aria-hidden="true" />
                </div>
                <div className="videoCardBody">
                  <div className="videoCardTitle">Qoidalar, belgilar va testlar bo‘yicha video tushuntirishlar</div>
                  <div className="videoCardText">
                    Har bir mavzuni video orqali ko‘rib chiqish, keyin esa shu mavzuga oid testlarni yechish imkoniyati bor.
                  </div>
                </div>
              </div>
            </section>

            <div className="seoHidden" aria-hidden="true">avto test road test roadt test avto imtihon haydovchilik testlari biletlar bo‘yicha test PDD test yo'l harakati qoidalari driving test</div>
          </section>
        </div>
      </main>

      <footer className="siteFooter">
        <div className="siteFooterInner">
          <div className="siteFooterLogo">
            <span className="textLogoRoad">ROAD</span>
            <span className="textLogoTest">TEST</span>
          </div>
          <div className="siteFooterLinks" aria-label="Social links">
            <a className="siteSocialLink" href="#" aria-label="Instagram">
              <InstagramMark />
            </a>
            <a className="siteSocialLink" href="#" aria-label="Telegram">
              <Send className="lucide" aria-hidden="true" />
            </a>
          </div>
        </div>
      </footer>

      {authOpen ? (
        <div className="authModalOverlay" role="presentation" onClick={closeAuth}>
          <div className="authModal" role="dialog" aria-modal="true" aria-labelledby="auth-modal-title" onClick={(event) => event.stopPropagation()}>
            <div className="authModalHeader">
              <div>
                <div className="authModalTitle" id="auth-modal-title">
                  {showForgotPassword ? "Parolni tiklash" : tab === "login" ? "Tizimga kirish" : "Ro‘yxatdan o‘tish"}
                </div>
                <div className="authModalText">
                  {showForgotPassword
                    ? "Emailingizni kiriting, sizga yangi parol yuboramiz."
                    : "Kirish yoki ro‘yxatdan o‘tish orqali testlar, biletlar va video darslardan foydalanasiz."}
                </div>
              </div>
              <button className="btn btn-ghost" type="button" onClick={closeAuth}>
                ✕
              </button>
            </div>

            {!showForgotPassword ? (
              <>
                <div className="authTabs" role="tablist" aria-label="Auth tabs">
                  <button type="button" className={`authTab ${tab === "login" ? "active" : ""}`} onClick={() => switchTab("login")} aria-pressed={tab === "login"}>
                    <ArrowRight className="lucide" aria-hidden="true" />
                    Tizimga kirish
                  </button>
                  <button type="button" className={`authTab ${tab === "register" ? "active" : ""}`} onClick={() => switchTab("register")} aria-pressed={tab === "register"}>
                    <UserPlus className="lucide" aria-hidden="true" />
                    Ro‘yxatdan o‘tish
                  </button>
                </div>

                <div className="authGoogleBlock">
                  <div className="authDivider">
                    <span>yoki Google bilan</span>
                  </div>
                  <div className="googleButtonMount" ref={googleButtonRef} />
                </div>
              </>
            ) : null}

            {showForgotPassword ? (
              <form className="formGrid authForm" onSubmit={onForgotPassword}>
                <div>
                  <div className="fieldLabel">Email</div>
                  <div className="inputGroup authInputGroup noRight">
                    <span className="inputAddon">
                      <Send className="lucide" aria-hidden="true" />
                    </span>
                    <input
                      name="email"
                      className="input inputField"
                      type="email"
                      placeholder="example@mail.com"
                      autoComplete="email"
                      value={forgotEmail}
                      onChange={(e) => setForgotEmail(e.target.value)}
                    />
                  </div>
                </div>
                <button className="btn btn-primary authSubmitBtn" type="submit" disabled={resetPasswordMutation.isPending}>
                      Kod yuborish
                </button>
                <button className="btn btn-ghost authSecondaryBtn" type="button" onClick={() => setShowForgotPassword(false)}>
                  Ortga qaytish
                </button>
              </form>
            ) : tab === "register" ? (
              <form className="formGrid authForm" onSubmit={onRegister}>
                <div>
                  <div className="fieldLabel">F.I.O</div>
                  <div className="inputGroup authInputGroup noRight">
                    <span className="inputAddon">
                      <UserRound className="lucide" aria-hidden="true" />
                    </span>
                    <input
                      name="fullName"
                      className="input inputField"
                      placeholder="To‘liq ism"
                      autoComplete="name"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                    />
                  </div>
                </div>

                <div>
                  <div className="fieldLabel">Telefon raqam</div>
                  <div className="inputGroup authInputGroup inputPhone noRight">
                    <span className="inputAddon inputAddonText">+998</span>
                    <input
                      name="phone"
                      className="input inputField"
                      placeholder="97-212-00-38"
                      autoComplete="tel"
                      inputMode="tel"
                      value={formatUzLocalPhone(phoneRegisterLocal)}
                      onChange={(e) => setPhoneRegisterLocal(uzLocalDigits(e.target.value))}
                    />
                  </div>
                </div>

                <div>
                  <div className="fieldLabel">Parol</div>
                  <div className="inputGroup authInputGroup">
                    <span className="inputAddon">
                      <KeyRound className="lucide" aria-hidden="true" />
                    </span>
                    <input
                      name="password"
                      className="input inputField"
                      type={showPass ? "text" : "password"}
                      placeholder="Kamida 6 ta belgi"
                      autoComplete="new-password"
                      value={passwordRegister}
                      onChange={(e) => setPasswordRegister(e.target.value)}
                    />
                    <button className="inputIconBtn" type="button" onClick={() => setShowPass((v) => !v)} aria-label="Show password">
                      {showPass ? <EyeOff className="lucide" aria-hidden="true" /> : <Eye className="lucide" aria-hidden="true" />}
                    </button>
                  </div>
                </div>
                <button className="btn btn-primary authSubmitBtn" type="submit" disabled={registerMutation.isPending}>
                  Ro‘yxatdan o‘tish
                </button>
              </form>
            ) : (
              <form className="formGrid authForm" onSubmit={onLogin}>
                <div>
                  <div className="fieldLabel">Telefon raqam</div>
                  <div className="inputGroup authInputGroup inputPhone noRight">
                    <span className="inputAddon inputAddonText">+998</span>
                    <input
                      name="phone"
                      className="input inputField"
                      placeholder="97-212-00-38"
                      autoComplete="tel"
                      inputMode="tel"
                      value={formatUzLocalPhone(phoneLoginLocal)}
                      onChange={(e) => setPhoneLoginLocal(uzLocalDigits(e.target.value))}
                    />
                  </div>
                </div>

                <div>
                  <div className="fieldLabel">Parol</div>
                  <div className="inputGroup authInputGroup">
                    <span className="inputAddon">
                      <KeyRound className="lucide" aria-hidden="true" />
                    </span>
                    <input
                      name="password"
                      className="input inputField"
                      type={showPass ? "text" : "password"}
                      placeholder="Parol"
                      autoComplete="current-password"
                      value={passwordLogin}
                      onChange={(e) => setPasswordLogin(e.target.value)}
                    />
                    <button className="inputIconBtn" type="button" onClick={() => setShowPass((v) => !v)} aria-label="Show password">
                      {showPass ? <EyeOff className="lucide" aria-hidden="true" /> : <Eye className="lucide" aria-hidden="true" />}
                    </button>
                  </div>
                  <div className="helpRow">
                    <button
                      className="linkBtn"
                      type="button"
                      onClick={() => setShowForgotPassword(true)}
                    >
                      Parolni unutdingizmi?
                    </button>
                  </div>
                </div>
                <button className="btn btn-primary authSubmitBtn" type="submit" disabled={loginMutation.isPending}>
                  Kirish
                </button>
              </form>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}
