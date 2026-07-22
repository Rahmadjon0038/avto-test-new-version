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
  Trash2,
  UserCircle2,
  Wallet
} from "lucide-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useAuth } from "@/app/auth-provider";
import { useSiteLanguage } from "@/app/site-language-provider";
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
  const { language, setLanguage, options, t } = useSiteLanguage();
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
  const [deleteAccountOpen, setDeleteAccountOpen] = useState(false);

  const initials = useMemo(() => getInitials(me?.full_name || ""), [me]);
  const displayName = useMemo(() => me?.full_name || t("profile.title"), [me, t]);
  const displayPhone = useMemo(() => me?.phone || t("profile.phoneMissing"), [me, t]);

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
    me?.password_reset_required ||
      me?.must_change_password ||
      user?.password_reset_required ||
      user?.must_change_password ||
      meQuery.data?.user?.password_reset_required ||
      meQuery.data?.user?.must_change_password
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
    mutationFn: async (payload: { currentPassword?: string; newPassword: string }) => {
      const res = await authFetch("/api/auth/password-change", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      return jsonOrError(res);
    },
    onSuccess: () => {
      const nextMe = me ? { ...me, password_reset_required: false, must_change_password: false } : me;
      if (nextMe) {
        setMe(nextMe);
        setUser(nextMe);
      }
      setPasswordChangeOpen(false);
      toast.success(t("profile.passwordChanged"));
    },
    onError: (error: any) => {
      toast.error(error?.message || t("profile.passwordChangeFailed"));
    }
  });

  function submitPasswordChange() {
    if (!mustChangePassword && !passwordCurrent.trim()) {
      toast.error(t("profile.currentPasswordRequired"));
      return;
    }
    if (passwordNext.length < 6) {
      toast.error(t("profile.newPasswordMin"));
      return;
    }
    if (passwordNext !== passwordNextConfirm) {
      toast.error(t("profile.passwordMismatch"));
      return;
    }
    passwordChangeMutation.mutate(
      mustChangePassword
        ? { newPassword: passwordNext.trim() }
        : { currentPassword: passwordCurrent.trim(), newPassword: passwordNext.trim() }
    );
  }

  const logoutMutation = useMutation({
    mutationFn: async () => {
      await fetch("/api/auth/logout", { method: "POST" });
      setAccessToken(null);
    },
    onSettled: () => router.replace("/")
  });

  const deleteAccountMutation = useMutation({
    mutationFn: async () => {
      const res = await authFetch("/api/auth/account", { method: "DELETE" });
      return jsonOrError(res);
    },
    onSuccess: () => {
      setDeleteAccountOpen(false);
      setProfileOpen(false);
      setPasswordChangeOpen(false);
      setAccessToken(null);
      setUser(null);
      toast.success(t("profile.accountDeleted"));
      router.replace("/");
    },
    onError: (error: any) => {
      toast.error(error?.message || t("profile.accountDeleteFailed"));
    }
  });

  function confirmPurchase() {
    setSubOpen(false);
    toast.success(t("profile.subscriptionPurchased"));
  }

  return (
    <>
      <header className="navbar">
        <div className="navbarInner">
          <div className="brand" role="button" tabIndex={0} onClick={() => router.push("/app")}>
            <div className="textLogo" aria-label="Topshirdi">
              <span className="textLogoRoad">Topshirdi</span>
            </div>
          </div>

          <div className="actions">
            <div className="actionRow">
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
                    <span>{option.shortLabel}</span>
                  </button>
                ))}
              </div>
              {isAdmin ? (
                <button className="btn btn-ghost headerActionBtn" type="button" onClick={() => router.push("/admin")}>
                  <ShieldCheck className="lucide" aria-hidden="true" /> {t("nav.adminPanel")}
                </button>
              ) : null}

              {showSubscriptionButton ? (
                <button className="btn btn-primary headerActionBtn" type="button" onClick={openSubscription}>
                  <span className="labelFull">{t("nav.buySubscription")}</span>
                  <span className="labelShort">{t("nav.subscription")}</span>
                </button>
              ) : null}

              <button className="profileChip headerActionBtn" type="button" title={t("nav.profile")} onClick={openProfile}>
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
            <span className="textLogoRoad">Topshirdi</span>
          </div>
          <div className="siteFooterLinks" aria-label="Social links">
            <a
              className="siteSocialLink"
              href="https://www.instagram.com/reel/DZZ3X7agYDW/"
              target="_blank"
              rel="noreferrer"
              aria-label={t("social.instagram")}
              title={t("social.instagram")}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <rect x="3.5" y="3.5" width="17" height="17" rx="5" fill="none" stroke="currentColor" strokeWidth="1.8" />
                <circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" strokeWidth="1.8" />
                <circle cx="17.1" cy="6.9" r="1.2" fill="currentColor" />
              </svg>
              <span className="siteSocialLinkText">{t("social.instagram")}</span>
            </a>
            <a
              className="siteSocialLink"
              href="https://t.me/JURABEK_AUTOTEACHER"
              target="_blank"
              rel="noreferrer"
              aria-label={t("social.telegram")}
              title={t("social.telegram")}
            >
              <Send className="lucide" aria-hidden="true" />
              <span className="siteSocialLinkText">{t("social.telegram")}</span>
            </a>
            <a className="siteSocialLink sitePrivacyLink" href="/privacy" aria-label={t("footer.privacy")} title={t("footer.privacy")}>
              <span className="siteSocialLinkText">{t("footer.privacy")}</span>
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
            if (!mustChangePassword) setPasswordChangeOpen(false);
          }}
        />
      )}

      {subOpen && (
        <div className="modal" role="dialog" aria-modal="true">
          <div className="modalHeader">
            <div className="modalTitle">{t("profile.subscriptionTitle")}</div>
            <button className="btn btn-ghost" type="button" onClick={() => setSubOpen(false)}>
              ✕
            </button>
          </div>
          <div className="modalBody">
            <div className="subGrid">
              <button className={`subOption ${plan === "1w" ? "active" : ""}`} type="button" onClick={() => setPlan("1w")}>
                <div className="subTitle">{t("profile.plan1w")}</div>
                <div className="subPrice">{t("profile.price1w")}</div>
              </button>
              <button className={`subOption ${plan === "2w" ? "active" : ""}`} type="button" onClick={() => setPlan("2w")}>
                <div className="subTitle">{t("profile.plan2w")}</div>
                <div className="subPrice">{t("profile.price2w")}</div>
              </button>
              <button className={`subOption ${plan === "1m" ? "active" : ""}`} type="button" onClick={() => setPlan("1m")}>
                <div className="subTitle">{t("profile.plan1m")}</div>
                <div className="subPrice">{t("profile.price1m")}</div>
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
              {t("profile.confirmPurchase")}
            </button>
          </div>
        </div>
      )}

      {profileOpen && (
        <div className="modal profileModal" role="dialog" aria-modal="true">
          <div className="modalHeader">
            <div className="modalTitle">{t("profile.title")}</div>
            <button className="btn btn-ghost" type="button" onClick={() => setProfileOpen(false)}>
              ✕
            </button>
          </div>
          <div className="modalBody">
            <div className="profileHero">
              <div className="profileAvatar">{initials}</div>
              <div className="profileIntro">
                <div className="profileName">{displayName}</div>
                <div className="profileSub">{t("profile.subtitle")}</div>
                <div className="profilePills">
                  <span className="profilePill profilePillAccent">
                    <BadgeCheck className="lucide" aria-hidden="true" /> {t("profile.active")}
                  </span>
                  <span className="profilePill">
                    <UserCircle2 className="lucide" aria-hidden="true" /> {t("profile.member")}
                  </span>
                </div>
              </div>
            </div>

            <div className="profileBlock">
              <div className="profileRow profileRowCard">
                <div className="profileKey">
                  <Phone className="lucide profileKeyIcon" aria-hidden="true" />
                  {t("profile.phone")}
                </div>
                <div className="profileVal">{displayPhone}</div>
              </div>
              <button className="btn btn-primary" type="button" onClick={openPasswordChange}>
                {t("profile.changePassword")}
              </button>
            </div>
            <button className="btn btn-danger" type="button" onClick={() => logoutMutation.mutate()} disabled={logoutMutation.isPending}>
              {t("profile.logout")}
            </button>
            <button
              className="btn btn-ghost"
              type="button"
              onClick={() => setDeleteAccountOpen(true)}
              style={{ marginTop: 10, color: "var(--danger)", borderColor: "rgba(185, 38, 38, 0.35)" }}
            >
              <Trash2 className="lucide" aria-hidden="true" /> {t("profile.deleteAccount")}
            </button>
          </div>
        </div>
      )}

      {deleteAccountOpen && (
        <div className="modal" role="dialog" aria-modal="true">
          <div className="modalHeader">
            <div className="modalTitle">{t("profile.deleteTitle")}</div>
            <button className="btn btn-ghost" type="button" onClick={() => setDeleteAccountOpen(false)}>
              ✕
            </button>
          </div>
          <div className="modalBody">
            <div className="authResetNotice" style={{ marginTop: 0 }}>
              <div className="authResetTitle">{t("profile.deleteWarningTitle")}</div>
              <div className="authResetText">
                {t("profile.deleteWarningText")}
              </div>
            </div>
            <div className="payRow" style={{ marginTop: 14 }}>
              <button className="btn btn-ghost payBtn" type="button" onClick={() => setDeleteAccountOpen(false)}>
                {t("profile.cancel")}
              </button>
              <button
                className="btn btn-danger payBtn"
                type="button"
                onClick={() => deleteAccountMutation.mutate()}
                disabled={deleteAccountMutation.isPending}
              >
                {t("profile.confirm")}
              </button>
            </div>
          </div>
        </div>
      )}

      {passwordChangeOpen && (
        <div className="modal" role="dialog" aria-modal="true">
          <div className="modalHeader">
            <div className="modalTitle">{t("profile.changePassword")}</div>
            {!mustChangePassword ? (
              <button className="btn btn-ghost" type="button" onClick={() => setPasswordChangeOpen(false)}>
                ✕
              </button>
            ) : null}
          </div>
          <div className="modalBody">
            <div className="profileBlock" style={{ marginTop: 0 }}>
              {!mustChangePassword ? (
                <div className="profileRow profileRowCard">
                  <div className="profileKey">
                    <KeyRound className="lucide profileKeyIcon" aria-hidden="true" />
                    {t("profile.currentPassword")}
                  </div>
                  <div className="profileVal" style={{ width: "100%" }}>
                    <input
                      className="input"
                      type={passwordVisible ? "text" : "password"}
                      value={passwordCurrent}
                      onChange={(e) => setPasswordCurrent(e.target.value)}
                      placeholder={t("profile.currentPassword")}
                      style={{ width: "100%" }}
                    />
                  </div>
                </div>
              ) : null}
              <div className="profileRow profileRowCard">
                <div className="profileKey">
                  <KeyRound className="lucide profileKeyIcon" aria-hidden="true" />
                  {t("profile.newPassword")}
                </div>
                <div className="profileVal" style={{ width: "100%" }}>
                  <input
                    className="input"
                    type={passwordVisible ? "text" : "password"}
                    value={passwordNext}
                    onChange={(e) => setPasswordNext(e.target.value)}
                    placeholder={t("profile.newPassword")}
                    style={{ width: "100%" }}
                  />
                </div>
              </div>
              <div className="profileRow profileRowCard">
                <div className="profileKey">
                  <KeyRound className="lucide profileKeyIcon" aria-hidden="true" />
                  {t("profile.confirmPassword")}
                </div>
                <div className="profileVal" style={{ width: "100%" }}>
                  <input
                    className="input"
                    type={passwordVisible ? "text" : "password"}
                    value={passwordNextConfirm}
                    onChange={(e) => setPasswordNextConfirm(e.target.value)}
                    placeholder={t("profile.confirmPassword")}
                    style={{ width: "100%" }}
                  />
                </div>
              </div>
            </div>
            <div className="payRow" style={{ marginTop: 4 }}>
              <button className="btn btn-ghost payBtn" type="button" onClick={() => setPasswordVisible((v) => !v)}>
                {passwordVisible ? <EyeOff className="lucide" aria-hidden="true" /> : <Eye className="lucide" aria-hidden="true" />}
                {passwordVisible ? t("profile.hidePassword") : t("profile.showPassword")}
              </button>
              <button className="btn btn-primary payBtn" type="button" onClick={submitPasswordChange} disabled={passwordChangeMutation.isPending}>
                {t("common.save")}
              </button>
            </div>
            {mustChangePassword ? (
              <div className="authResetNotice" style={{ marginTop: 12 }}>
                <div className="authResetTitle">{t("profile.deleteWarningTitle")}</div>
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
