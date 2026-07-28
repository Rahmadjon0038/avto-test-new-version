"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Eye, EyeOff, KeyRound, X } from "lucide-react";
import toast from "react-hot-toast";
import { useMutation } from "@tanstack/react-query";
import { useAuth } from "@/app/auth-provider";
import { useSiteLanguage } from "@/app/site-language-provider";
import { jsonOrError } from "@/lib/api-authed";

type Tab = "register" | "login";

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

function normalizeUzLocalDigits(value: string) {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return "";
  const local = digits.startsWith("998") ? digits.slice(3) : digits;
  return local.slice(0, 9);
}

export default function PublicAuthModal({
  open,
  initialTab = "login",
  onClose
}: {
  open: boolean;
  initialTab?: Tab;
  onClose: () => void;
}) {
  const router = useRouter();
  const { setAccessToken, setUser } = useAuth();
  const { t } = useSiteLanguage();
  const [tab, setTab] = useState<Tab>(initialTab);
  const [phoneRegisterLocal, setPhoneRegisterLocal] = useState("");
  const [passwordRegister, setPasswordRegister] = useState("");
  const [phoneLoginLocal, setPhoneLoginLocal] = useState("");
  const [passwordLogin, setPasswordLogin] = useState("");
  const [showPass, setShowPass] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTab(initialTab);
  }, [initialTab, open]);

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  const close = () => {
    onClose();
  };

  function switchTab(nextTab: Tab) {
    toast.dismiss();
    setTab(nextTab);
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
      close();
      router.push("/app");
    },
    onError: (e: any) => toast.error(e?.message || t("common.error"))
  });

  function openForgotTelegram() {
    const phoneDigits = normalizeUzLocalDigits(phoneLoginLocal);
    const phone = phoneDigits.length === 9 ? `+998${phoneDigits}` : "";
    const text = `Salom, men Topshirdi ilovasida parolimni unutdim. Telefon raqamim: ${phone}`;
    const adminUsername = String("Rahmadjonn").replace(/^@/, "");
    window.open(`https://t.me/${encodeURIComponent(adminUsername)}?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
  }

  function onRegister(e: React.FormEvent) {
    e.preventDefault();
    const form = e.currentTarget as HTMLFormElement;
    const formData = new FormData(form);
    const rawPhone = String(formData.get("phone") || phoneRegisterLocal);
    const rawPassword = String(formData.get("password") || passwordRegister);
    const phoneDigits = normalizeUzLocalDigits(rawPhone);

    if (phoneDigits.length !== 9) return toast.error(t("auth.phoneFormatInvalid"));
    if (rawPassword.length < 6) return toast.error(t("auth.passwordTooShort"));

    registerMutation.mutate({
      phone: `+998${phoneDigits}`,
      password: rawPassword
    });
  }

  function onLogin(e: React.FormEvent) {
    e.preventDefault();
    const form = e.currentTarget as HTMLFormElement;
    const formData = new FormData(form);
    const rawPhone = String(formData.get("phone") || phoneLoginLocal);
    const rawPassword = String(formData.get("password") || passwordLogin);
    const phoneDigits = normalizeUzLocalDigits(rawPhone);

    if (phoneDigits.length !== 9) return toast.error(t("auth.phoneFormatInvalid"));
    if (!rawPassword) return toast.error(t("auth.passwordRequired"));

    loginMutation.mutate({ phone: `+998${phoneDigits}`, password: rawPassword });
  }

  if (!open) return null;

  return (
    <div className="authModalOverlay" role="presentation" onClick={close}>
      <div className="authModal" role="dialog" aria-modal="true" aria-labelledby="auth-modal-title" onClick={(event) => event.stopPropagation()}>
        <div className="authModalHeader">
          <div className="authModalTitleWrap">
            <div className="authModalTitle" id="auth-modal-title">
              {tab === "login" ? t("auth.loginTitle") : t("auth.registerTitle")}
            </div>
          </div>
          <button className="btn btn-ghost" type="button" onClick={close} aria-label={t("common.close")}>
            <X className="lucide" aria-hidden="true" />
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
                  onChange={(e) => setPhoneRegisterLocal(normalizeUzLocalDigits(e.target.value))}
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
                  onChange={(e) => setPhoneLoginLocal(normalizeUzLocalDigits(e.target.value))}
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
            <button className="authForgotBtn" type="button" onClick={openForgotTelegram}>
              {t("auth.forgotPassword")}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
