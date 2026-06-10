"use client";

import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { BadgeCheck, CreditCard, ShieldCheck, Phone, Send, UserCircle2, Wallet } from "lucide-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useAuth } from "@/app/auth-provider";
import { jsonOrError } from "@/lib/api-authed";

type SubPlan = "1w" | "2w" | "1m";
type PayProvider = "click" | "payme";

declare global {
  interface Window {
    google?: any;
  }
}

const GOOGLE_WEB_CLIENT_ID = "844953821020-2dcgvd7i32rvpj552gkgopat9278tnfe.apps.googleusercontent.com";

function getInitials(name: string) {
  const s = String(name || "").trim();
  if (!s) return "JA";
  const parts = s.split(/\s+/).filter(Boolean);
  const a = parts[0]?.[0] || "J";
  const b = parts.length > 1 ? parts[parts.length - 1]?.[0] : parts[0]?.[1];
  return (a + (b || "")).toUpperCase();
}

export default function AppShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { authFetch, setAccessToken, setUser, authReady, accessToken, user } = useAuth();
  const showSubscriptionButton = false;

  const [me, setMe] = useState<any>(null);

  const [subOpen, setSubOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [googleLinkLoading, setGoogleLinkLoading] = useState(false);
  const [plan, setPlan] = useState<SubPlan>("1m");
  const [provider, setProvider] = useState<PayProvider>("payme");
  const googleLinkButtonRef = useRef<HTMLDivElement | null>(null);
  const googleLinkLoadedRef = useRef(false);

  const initials = useMemo(() => getInitials(me?.full_name || ""), [me]);
  const displayName = useMemo(() => me?.full_name || "Profil", [me]);
  const displayPhone = useMemo(() => me?.phone || "Telefon qo‘shilmagan", [me]);

  useEffect(() => {
    if (user) setMe(user);
  }, [user]);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", "dark");
  }, []);

  useEffect(() => {
    if (!profileOpen || me?.google_sub) return;

    if (googleLinkLoadedRef.current) {
      const google = window.google;
      if (google?.accounts?.id && googleLinkButtonRef.current) {
        googleLinkButtonRef.current.innerHTML = "";
        google.accounts.id.renderButton(googleLinkButtonRef.current, {
          theme: "outline",
          size: "large",
          width: googleLinkButtonRef.current.offsetWidth || 360,
          text: "signin_with",
          shape: "pill"
        });
      }
      return;
    }

    const scriptId = "google-gsi-script-app-shell";
    const existingScript = document.getElementById(scriptId) as HTMLScriptElement | null;
    const initGoogle = () => {
      const google = window.google;
      if (!google?.accounts?.id || !googleLinkButtonRef.current) return;
      googleLinkButtonRef.current.innerHTML = "";
      google.accounts.id.initialize({
        client_id: GOOGLE_WEB_CLIENT_ID,
        callback: async (response: { credential?: string }) => {
          const credential = String(response?.credential || "");
          if (!credential) {
            toast.error("Google token topilmadi");
            return;
          }
          try {
            setGoogleLinkLoading(true);
            const res = await fetch("/api/auth/google", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${accessToken}`
              },
              body: JSON.stringify({ idToken: credential })
            });
            const data = await jsonOrError(res);
            if (data?.user) {
              setMe(data.user);
              setUser(data.user);
            }
            toast.success("Google akkaunti ulandi");
          } catch (error: any) {
            toast.error(error?.message || "Google ulandi");
          } finally {
            setGoogleLinkLoading(false);
          }
        }
      });
      google.accounts.id.renderButton(googleLinkButtonRef.current, {
        theme: "outline",
        size: "large",
        width: googleLinkButtonRef.current.offsetWidth || 360,
        text: "signin_with",
        shape: "pill"
      });
      googleLinkLoadedRef.current = true;
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
  }, [accessToken, me?.google_sub, profileOpen, setMe, setUser]);

  const meQuery = useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      const res = await authFetch("/api/auth/me");
      return jsonOrError(res);
    },
    retry: false,
    enabled: authReady && !!accessToken
  });
  const isAdmin = Boolean(me?.is_admin || user?.is_admin || meQuery.data?.user?.is_admin);

  useEffect(() => {
    if (meQuery.isSuccess && meQuery.data?.user) {
      setMe(meQuery.data.user);
      setUser(meQuery.data.user);
    }
    if (!authReady) return;
    if (!accessToken) {
      setMe(null);
      setUser(null);
      router.replace("/");
      return;
    }
    if (meQuery.isError || (meQuery.isSuccess && !meQuery.data?.user)) {
      setMe(null);
      setUser(null);
      setAccessToken(null);
      router.replace("/");
    }
  }, [meQuery.isSuccess, meQuery.isError, meQuery.data, router, authReady, accessToken, setUser, setAccessToken]);

  function openSubscription() {
    setProfileOpen(false);
    setSubOpen(true);
  }

  function openProfile() {
    setSubOpen(false);
    setProfileOpen(true);
  }

  const logoutMutation = useMutation({
    mutationFn: async () => {
      await fetch("/api/auth/logout", { method: "POST" });
      setAccessToken(null);
    },
    onSettled: () => router.replace("/")
  });

  function confirmPurchase() {
    setSubOpen(false);
    toast.success("Obuna sotib olindi");
  }

  return (
    <>
      <header className="navbar">
        <div className="navbarInner">
          <div className="brand" role="button" tabIndex={0} onClick={() => router.push("/app")}>
            <div className="textLogo" aria-label="ROAD TEST">
              <span className="textLogoRoad">ROAD</span>
              <span className="textLogoTest">TEST</span>
            </div>
          </div>

          <div className="actions">
            <div className="actionRow">
              {isAdmin ? (
                <button className="btn btn-ghost headerActionBtn" type="button" onClick={() => router.push("/admin")}>
                  <ShieldCheck className="lucide" aria-hidden="true" /> Admin panel
                </button>
              ) : null}

              {showSubscriptionButton ? (
                <button className="btn btn-primary headerActionBtn" type="button" onClick={openSubscription}>
                  <span className="labelFull">Obunani sotib olish</span>
                  <span className="labelShort">Obuna</span>
                </button>
              ) : null}

              <button className="profileChip headerActionBtn" type="button" title="Profil" onClick={openProfile}>
                <span className="avatarCircle">{initials}</span>
                <span id="profileName">{displayName}</span>
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="container">{children}</main>

      {(subOpen || profileOpen) && <div className="modalOverlay" onClick={() => (setSubOpen(false), setProfileOpen(false))} />}

      {subOpen && (
        <div className="modal" role="dialog" aria-modal="true">
          <div className="modalHeader">
            <div className="modalTitle">Obuna tanlang</div>
            <button className="btn btn-ghost" type="button" onClick={() => setSubOpen(false)}>
              ✕
            </button>
          </div>
          <div className="modalBody">
            <div className="subGrid">
              <button className={`subOption ${plan === "1w" ? "active" : ""}`} type="button" onClick={() => setPlan("1w")}>
                <div className="subTitle">1 haftalik</div>
                <div className="subPrice">14 000 so‘m</div>
              </button>
              <button className={`subOption ${plan === "2w" ? "active" : ""}`} type="button" onClick={() => setPlan("2w")}>
                <div className="subTitle">2 haftalik</div>
                <div className="subPrice">28 000 so‘m</div>
              </button>
              <button className={`subOption ${plan === "1m" ? "active" : ""}`} type="button" onClick={() => setPlan("1m")}>
                <div className="subTitle">1 oylik</div>
                <div className="subPrice">45 000 so‘m</div>
              </button>
            </div>

            <div className="payRow">
              <button className={`btn btn-ghost payBtn ${provider === "click" ? "active" : ""}`} type="button" onClick={() => setProvider("click")}>
                <CreditCard className="lucide" aria-hidden="true" /> Click
              </button>
              <button className={`btn btn-ghost payBtn ${provider === "payme" ? "active" : ""}`} type="button" onClick={() => setProvider("payme")}>
                <Wallet className="lucide" aria-hidden="true" /> Payme
              </button>
            </div>

            <button className="btn btn-primary" type="button" onClick={confirmPurchase}>
              Roziman
            </button>
          </div>
        </div>
      )}

      {profileOpen && (
        <div className="modal" role="dialog" aria-modal="true">
          <div className="modalHeader">
            <div className="modalTitle">Profil</div>
            <button className="btn btn-ghost" type="button" onClick={() => setProfileOpen(false)}>
              ✕
            </button>
          </div>
          <div className="modalBody">
            <div className="profileHero">
              <div className="profileAvatar">{initials}</div>
              <div className="profileIntro">
                <div className="profileName">{displayName}</div>
                <div className="profileSub">Sizning shaxsiy kabinet ma’lumotlaringiz</div>
                <div className="profilePills">
                  <span className="profilePill profilePillAccent">
                    <BadgeCheck className="lucide" aria-hidden="true" /> Faol profil
                  </span>
                  <span className="profilePill">
                    <UserCircle2 className="lucide" aria-hidden="true" /> A'zo
                  </span>
                </div>
              </div>
            </div>

            <div className="profileBlock">
              <div className="profileRow profileRowCard">
                <div className="profileKey">
                  <Phone className="lucide profileKeyIcon" aria-hidden="true" />
                  Telefon
                </div>
                <div className="profileVal">{displayPhone}</div>
              </div>
              <button className="profileRow profileRowCard profileRowButton" type="button" onClick={openSubscription}>
                <div className="profileKey">
                  <BadgeCheck className="lucide profileKeyIcon" aria-hidden="true" />
                  Obuna
                </div>
                <div className="profileVal profileValStatus">Faol emas</div>
              </button>
            </div>
            {!me?.google_sub ? (
              <div className="profileBlock">
                <div className="profileRow profileRowCard">
                  <div className="profileKey">
                    <Send className="lucide profileKeyIcon" aria-hidden="true" />
                    Google ulash
                  </div>
                  <div className="profileVal profileValStatus">Bitta akkauntga birlashtirish</div>
                </div>
                <div className="authGoogleBlock" style={{ padding: 0, marginTop: 10 }}>
                  <div className="googleButtonMount" ref={googleLinkButtonRef} />
                </div>
              </div>
            ) : null}
            <button className="btn btn-danger" type="button" onClick={() => logoutMutation.mutate()} disabled={logoutMutation.isPending}>
              Chiqish
            </button>
          </div>
        </div>
      )}
    </>
  );
}
