"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Send } from "lucide-react";
import toast from "react-hot-toast";
import { useSiteLanguage } from "@/app/site-language-provider";
import { jsonOrError } from "@/lib/api-authed";

type TelegramConfig = { botEnabled: boolean; loginEnabled: boolean };

const POLL_INTERVAL_MS = 2000;
const MAX_WAIT_MS = 5 * 60 * 1000;

// Konfiguratsiya sahifa umri davomida bir marta so'raladi (modal qayta-qayta ochilganda so'rov takrorlanmasin).
let configPromise: Promise<TelegramConfig> | null = null;
function loadConfig(): Promise<TelegramConfig> {
  if (!configPromise) {
    configPromise = fetch("/api/auth/telegram/config")
      .then((res) => (res.ok ? res.json() : {}))
      .then((data: any) => ({ botEnabled: data?.botEnabled === true, loginEnabled: data?.loginEnabled === true }))
      .catch(() => {
        configPromise = null;
        return { botEnabled: false, loginEnabled: false };
      });
  }
  return configPromise;
}

export function useTelegramConfig(): TelegramConfig | null {
  const [config, setConfig] = useState<TelegramConfig | null>(null);
  useEffect(() => {
    let alive = true;
    loadConfig().then((value) => {
      if (alive) setConfig(value);
    });
    return () => {
      alive = false;
    };
  }, []);
  return config;
}

// "Telegram orqali kirish": bot (yoki Telegram OIDC) ochiladi, foydalanuvchi Telegramda tasdiqlaydi,
// sayt esa natijani `state` bo'yicha so'rab (polling) kirishni yakunlaydi.
// mode="reset": "Parolni unutdingizmi?" — bot yangi parol beradi va sayt avtomatik kiradi (faqat bot bilan).
export default function TelegramLoginButton({
  onSuccess,
  mode = "login"
}: {
  onSuccess: (data: any) => void;
  mode?: "login" | "reset";
}) {
  const { t } = useSiteLanguage();
  const config = useTelegramConfig();
  const isReset = mode === "reset";
  const [busy, setBusy] = useState(false);
  const [openUrl, setOpenUrl] = useState<string | null>(null);
  const stateRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const deadlineRef = useRef(0);
  const inFlightRef = useRef(false);
  const onSuccessRef = useRef(onSuccess);
  onSuccessRef.current = onSuccess;

  function stop() {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    stateRef.current = null;
    setOpenUrl(null);
  }

  async function poll() {
    const state = stateRef.current;
    if (!state || inFlightRef.current) return;
    if (Date.now() > deadlineRef.current) {
      stop();
      toast.error(t("auth.telegramFailed"));
      return;
    }
    inFlightRef.current = true;
    try {
      const res = await fetch(`/api/auth/telegram/bot/status?state=${encodeURIComponent(state)}`, { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (stateRef.current !== state) return;
      if (res.ok && data?.accessToken) {
        stop();
        onSuccessRef.current(data);
      } else if (!res.ok) {
        stop();
        toast.error(data?.error || t("auth.telegramFailed"));
      }
    } catch {
      // Tarmoq xatosi: keyingi urinishda qayta so'raymiz.
    } finally {
      inFlightRef.current = false;
    }
  }

  // Telegramdan sahifaga qaytganda natijani darrov so'raymiz; sahifa yopilsa so'rash to'xtaydi.
  useEffect(() => {
    const onVisible = () => {
      if (!document.hidden) void poll();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
      stateRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function start() {
    if (!config || busy) return;
    // Oyna bosish paytining o'zida ochiladi (so'rovdan keyin ochilsa brauzer bloklaydi), manzil keyin qo'yiladi.
    const popup = window.open("about:blank", "_blank");
    setBusy(true);
    try {
      const startPath = isReset ? "reset" : config.botEnabled ? "bot" : "oidc";
      const res = await fetch(`/api/auth/telegram/${startPath}/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}"
      });
      const data = await jsonOrError(res);
      if (!data?.state || !data?.authUrl) throw new Error(t("auth.telegramFailed"));
      if (popup) popup.location.href = String(data.authUrl);
      stateRef.current = String(data.state);
      deadlineRef.current = Date.now() + MAX_WAIT_MS;
      setOpenUrl(String(data.authUrl));
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = setInterval(() => void poll(), POLL_INTERVAL_MS);
    } catch (error: any) {
      popup?.close();
      toast.error(error?.message || t("auth.telegramFailed"));
    } finally {
      setBusy(false);
    }
  }

  if (!config || (isReset ? !config.botEnabled : !config.botEnabled && !config.loginEnabled)) return null;

  return (
    <div className="authTelegramBlock">
      {isReset ? null : (
        <div className="authDivider">
          <span>{t("auth.orTelegram")}</span>
        </div>
      )}
      {openUrl ? (
        <div className="authTelegramWaiting">
          <Loader2 className="lucide authTelegramSpin" aria-hidden="true" />
          <div className="authTelegramWaitingTitle">{t("auth.telegramWaiting")}</div>
          <p className="authTelegramWaitingText">{t(isReset ? "auth.telegramResetHint" : "auth.telegramHint")}</p>
          <a className="authTelegramBtn" href={openUrl} target="_blank" rel="noopener noreferrer">
            <Send className="lucide" aria-hidden="true" />
            {t("auth.telegramOpen")}
          </a>
          <button className="btn btn-ghost" type="button" onClick={stop}>
            {t("auth.telegramCancel")}
          </button>
        </div>
      ) : (
        <button className="authTelegramBtn" type="button" onClick={() => void start()} disabled={busy}>
          <Send className="lucide" aria-hidden="true" />
          {t(isReset ? "auth.telegramReset" : "auth.telegramLogin")}
        </button>
      )}
      {isReset ? <p className="authTelegramWaitingText">{t("auth.resetNote")}</p> : null}
    </div>
  );
}
