"use client";

import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import {
  BadgeCheck,
  CreditCard,
  Eye,
  EyeOff,
  KeyRound,
  Send,
  ShieldCheck,
  Phone,
  UserCircle2,
  Wallet
} from "lucide-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useAuth } from "@/app/auth-provider";
import { jsonOrError } from "@/lib/api-authed";

type SubPlan = "1w" | "2w" | "1m";
type PayProvider = "click" | "payme";

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
  const [plan, setPlan] = useState<SubPlan>("1m");
  const [provider, setProvider] = useState<PayProvider>("payme");
  const [passwordChangeOpen, setPasswordChangeOpen] = useState(false);
  const [passwordCurrent, setPasswordCurrent] = useState("");
  const [passwordNext, setPasswordNext] = useState("");
  const [passwordNextConfirm, setPasswordNextConfirm] = useState("");
  const [passwordVisible, setPasswordVisible] = useState(false);

  const initials = useMemo(() => getInitials(me?.full_name || ""), [me]);
  const displayName = useMemo(() => me?.full_name || "Profil", [me]);
  const displayPhone = useMemo(() => me?.phone || "Telefon qo‘shilmagan", [me]);

  useEffect(() => {
    if (user) setMe(user);
  }, [user]);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", "dark");
  }, []);

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
  const mustChangePassword = Boolean(
    me?.password_reset_required || user?.password_reset_required || meQuery.data?.user?.password_reset_required
  );

  useEffect(() => {
    if (mustChangePassword) {
      setPasswordChangeOpen(true);
    }
  }, [mustChangePassword]);

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

  function openPasswordChange() {
    setProfileOpen(false);
    setPasswordChangeOpen(true);
    setPasswordCurrent("");
    setPasswordNext("");
    setPasswordNextConfirm("");
    setPasswordVisible(false);
  }

  const passwordChangeMutation = useMutation({
    mutationFn: async (payload: { currentPassword: string; newPassword: string }) => {
      const res = await authFetch("/api/auth/password-change", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      return jsonOrError(res);
    },
    onSuccess: () => {
      const nextMe = me ? { ...me, password_reset_required: false } : me;
      if (nextMe) {
        setMe(nextMe);
        setUser(nextMe);
      }
      setPasswordChangeOpen(false);
      toast.success("Parol muvaffaqiyatli almashtirildi");
    },
    onError: (error: any) => {
      toast.error(error?.message || "Parol almashtirilmadi");
    }
  });

  function submitPasswordChange() {
    if (!passwordCurrent.trim()) {
      toast.error("Eski parolni kiriting");
      return;
    }
    if (passwordNext.length < 6) {
      toast.error("Yangi parol kamida 6 ta belgidan iborat bo‘lsin");
      return;
    }
    if (passwordNext !== passwordNextConfirm) {
      toast.error("Yangi parollar mos emas");
      return;
    }
    passwordChangeMutation.mutate({
      currentPassword: passwordCurrent.trim(),
      newPassword: passwordNext.trim()
    });
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

      <footer className="siteFooter">
        <div className="siteFooterInner">
          <div className="siteFooterLogo">
            <span className="textLogoRoad">ROAD</span>
            <span className="textLogoTest">TEST</span>
          </div>
          <div className="siteFooterLinks" aria-label="Social links">
            <a
              className="siteSocialLink"
              href="https://www.instagram.com/reel/DZZ3X7agYDW/"
              target="_blank"
              rel="noreferrer"
              aria-label="Instagram"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <rect x="3.5" y="3.5" width="17" height="17" rx="5" fill="none" stroke="currentColor" strokeWidth="1.8" />
                <circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" strokeWidth="1.8" />
                <circle cx="17.1" cy="6.9" r="1.2" fill="currentColor" />
              </svg>
            </a>
            <a
              className="siteSocialLink"
              href="https://t.me/JURABEK_AUTOTEACHER"
              target="_blank"
              rel="noreferrer"
              aria-label="Telegram"
            >
              <Send className="lucide" aria-hidden="true" />
            </a>
          </div>
        </div>
      </footer>

      {(subOpen || profileOpen || passwordChangeOpen) && (
        <div
          className="modalOverlay"
          onClick={() => {
            setSubOpen(false);
            setProfileOpen(false);
            setPasswordChangeOpen(false);
          }}
        />
      )}

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
              <button className="btn btn-primary" type="button" onClick={openPasswordChange}>
                Parolni almashtirish
              </button>
            </div>
            <button className="btn btn-danger" type="button" onClick={() => logoutMutation.mutate()} disabled={logoutMutation.isPending}>
              Chiqish
            </button>
          </div>
        </div>
      )}

      {passwordChangeOpen && (
        <div className="modal" role="dialog" aria-modal="true">
          <div className="modalHeader">
            <div className="modalTitle">Parolni almashtirish</div>
            <button className="btn btn-ghost" type="button" onClick={() => setPasswordChangeOpen(false)}>
              ✕
            </button>
          </div>
          <div className="modalBody">
            <div className="profileBlock" style={{ marginTop: 0 }}>
              <div className="profileRow profileRowCard">
                <div className="profileKey">
                  <KeyRound className="lucide profileKeyIcon" aria-hidden="true" />
                  Eski parol
                </div>
                <div className="profileVal" style={{ width: "100%" }}>
                  <input
                    className="input"
                    type={passwordVisible ? "text" : "password"}
                    value={passwordCurrent}
                    onChange={(e) => setPasswordCurrent(e.target.value)}
                    placeholder="Eski parol"
                    style={{ width: "100%" }}
                  />
                </div>
              </div>
              <div className="profileRow profileRowCard">
                <div className="profileKey">
                  <KeyRound className="lucide profileKeyIcon" aria-hidden="true" />
                  Yangi parol
                </div>
                <div className="profileVal" style={{ width: "100%" }}>
                  <input
                    className="input"
                    type={passwordVisible ? "text" : "password"}
                    value={passwordNext}
                    onChange={(e) => setPasswordNext(e.target.value)}
                    placeholder="Kamida 6 ta belgi"
                    style={{ width: "100%" }}
                  />
                </div>
              </div>
              <div className="profileRow profileRowCard">
                <div className="profileKey">
                  <KeyRound className="lucide profileKeyIcon" aria-hidden="true" />
                  Takrorlang
                </div>
                <div className="profileVal" style={{ width: "100%" }}>
                  <input
                    className="input"
                    type={passwordVisible ? "text" : "password"}
                    value={passwordNextConfirm}
                    onChange={(e) => setPasswordNextConfirm(e.target.value)}
                    placeholder="Yangi parolni tasdiqlang"
                    style={{ width: "100%" }}
                  />
                </div>
              </div>
            </div>
            <div className="payRow" style={{ marginTop: 4 }}>
              <button className="btn btn-ghost payBtn" type="button" onClick={() => setPasswordVisible((v) => !v)}>
                {passwordVisible ? <EyeOff className="lucide" aria-hidden="true" /> : <Eye className="lucide" aria-hidden="true" />}
                {passwordVisible ? "Yashirish" : "Ko‘rsatish"}
              </button>
              <button className="btn btn-primary payBtn" type="button" onClick={submitPasswordChange} disabled={passwordChangeMutation.isPending}>
                Saqlash
              </button>
            </div>
            {mustChangePassword ? (
              <div className="authResetNotice" style={{ marginTop: 12 }}>
                <div className="authResetTitle">Diqqat</div>
                <div className="authResetText">
                  Siz bir martalik parol bilan kirgansiz. Parolni almashtirmaguningizcha tizimdan to‘liq foydalanish uchun
                  shu oynadan yangi parol qo‘ying.
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}
    </>
  );
}
