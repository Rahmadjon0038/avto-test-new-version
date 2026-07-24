"use client";

import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { RefreshCw, Save, ShieldAlert } from "lucide-react";
import toast from "react-hot-toast";
import { useAuth } from "@/app/auth-provider";
import { useSiteLanguage } from "@/app/site-language-provider";
import { jsonOrError } from "@/lib/api-authed";

type I18nText = {
  uz_latn: string;
  uz_cyrl: string;
  ru: string;
};

type AppConfig = {
  warningEnabled: boolean;
  forceUpdate: boolean;
  updateUrl: string;
  updateUrlAndroid: string;
  updateUrlIos: string;
  syncOnLaunch: boolean;
  videoOnlineOnly: boolean;
  audioOfflineCache: boolean;
  audioPremiumRequired: boolean;
  videoPremiumRequired: boolean;
  warning: {
    titleI18n: I18nText;
    messageI18n: I18nText;
    actionLabelI18n: I18nText;
  };
  updatedAt?: string | null;
};

type OfflineManifest = {
  generatedAt?: string;
  version?: string;
  sections?: {
    topics?: { count?: number; updatedAt?: string | null };
    tickets?: { count?: number; updatedAt?: string | null };
    customTests?: { count?: number; updatedAt?: string | null };
    videos?: { count?: number; updatedAt?: string | null };
  };
};

const emptyI18n = (): I18nText => ({
  uz_latn: "",
  uz_cyrl: "",
  ru: ""
});

const emptyConfig = (): AppConfig => ({
  warningEnabled: false,
  forceUpdate: false,
  updateUrl: "https://topshirdi.uz",
  updateUrlAndroid: "https://play.google.com/store/apps/details?id=uz.roadtest.app&hl=en_IE",
  updateUrlIos: "https://apps.apple.com/us/app/topshirdi/id6781198005",
  syncOnLaunch: true,
  videoOnlineOnly: true,
  audioOfflineCache: true,
  audioPremiumRequired: false,
  videoPremiumRequired: false,
  warning: {
    titleI18n: {
      uz_latn: "Ilovani yangilang",
      uz_cyrl: "Иловани янгиланг",
      ru: "Обновите приложение"
    },
    messageI18n: {
      uz_latn: "Yangi funksiyalar va barqaror ishlash uchun ilovani yangilang.",
      uz_cyrl: "Янги функциялар ва барқарор ишлаш учун иловани янгиланг.",
      ru: "Обновите приложение, чтобы получить новые функции и стабильную работу."
    },
    actionLabelI18n: {
      uz_latn: "Yangilash",
      uz_cyrl: "Янгилаш",
      ru: "Обновить"
    }
  },
  updatedAt: null
});

function readI18n(value: any, fallback: I18nText): I18nText {
  const source = value && typeof value === "object" ? value : {};
  return {
    uz_latn: String(source.uz_latn ?? fallback.uz_latn ?? ""),
    uz_cyrl: String(source.uz_cyrl ?? fallback.uz_cyrl ?? ""),
    ru: String(source.ru ?? fallback.ru ?? "")
  };
}

function readBool(value: any, fallback = false) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (!normalized) return fallback;
    if (["true", "1", "yes", "on"].includes(normalized)) return true;
    if (["false", "0", "no", "off"].includes(normalized)) return false;
  }
  return Boolean(value);
}

function readConfig(value: any): AppConfig {
  const fallback = emptyConfig();
  const source = value && typeof value === "object" ? value : {};
  const warning = source.warning && typeof source.warning === "object" ? source.warning : {};
  return {
    warningEnabled: readBool(source.warningEnabled, false),
    forceUpdate: readBool(source.forceUpdate, false),
    updateUrl: String(source.updateUrl || fallback.updateUrl),
    updateUrlAndroid: String(source.updateUrlAndroid || fallback.updateUrlAndroid),
    updateUrlIos: String(source.updateUrlIos || fallback.updateUrlIos),
    syncOnLaunch: readBool(source.syncOnLaunch, true),
    videoOnlineOnly: readBool(source.videoOnlineOnly, true),
    audioOfflineCache: readBool(source.audioOfflineCache, true),
    audioPremiumRequired: readBool(source.audioPremiumRequired, false),
    videoPremiumRequired: readBool(source.videoPremiumRequired, false),
    warning: {
      titleI18n: readI18n(warning.titleI18n, fallback.warning.titleI18n),
      messageI18n: readI18n(warning.messageI18n, fallback.warning.messageI18n),
      actionLabelI18n: readI18n(warning.actionLabelI18n, fallback.warning.actionLabelI18n)
    },
    updatedAt: source.updatedAt ?? null
  };
}

export default function AdminHomePage() {
  const queryClient = useQueryClient();
  const { authFetch } = useAuth();
  const { language } = useSiteLanguage();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [manifest, setManifest] = useState<OfflineManifest | null>(null);
  const [config, setConfig] = useState<AppConfig>(() => emptyConfig());

  const sections = useMemo(
    () => [
      { label: "Mavzular", value: manifest?.sections?.topics?.count ?? 0 },
      { label: "Biletlar", value: manifest?.sections?.tickets?.count ?? 0 },
      { label: "Sozlamali testlar", value: manifest?.sections?.customTests?.count ?? 0 },
      { label: "Video darslar", value: manifest?.sections?.videos?.count ?? 0 }
    ],
    [manifest]
  );

  const loadConfig = async () => {
    setLoading(true);
    try {
      const res = await authFetch(`/api/admin/app-config?lang=${encodeURIComponent(language)}`);
      const data = await jsonOrError(res);
      setConfig(readConfig(data.appConfig));
      setManifest(data.manifest ?? null);
    } catch (error: any) {
      toast.error(error?.message || "Sozlamalar yuklanmadi");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadConfig();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language]);

  const updateText = (section: "titleI18n" | "messageI18n" | "actionLabelI18n", lang: keyof I18nText, value: string) => {
    setConfig((current) => ({
      ...current,
      warning: {
        ...current.warning,
        [section]: {
          ...current.warning[section],
          [lang]: value
        }
      }
    }));
  };

  const save = async () => {
    try {
      setSaving(true);
      const res = await authFetch("/api/admin/app-config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config)
      });
      const data = await jsonOrError(res);
      setConfig(readConfig(data.appConfig));
      toast.success("Saqlandi");
      await queryClient.invalidateQueries();
      await loadConfig();
    } catch (error: any) {
      toast.error(error?.message || "Saqlab bo‘lmadi");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="adminSectionPage">
      <div className="adminPanelCard card" style={{ marginTop: 0 }}>
        <div className="adminPanelCardHead">
          <div className="adminPanelCardTitle">
            <ShieldAlert className="lucide" aria-hidden="true" /> Ilova yangilanishi
          </div>
          <div className="adminPanelCardDesc">
            Mobil ilovada update/warning oynasini boshqarish va offline sinxron metadata sini ko‘rish.
          </div>
        </div>

        <div className="adminSectionStats" style={{ marginTop: 16 }}>
          {sections.map((item) => (
            <div key={item.label} className="adminStatCard">
              <div className="adminStatLabel">{item.label}</div>
              <div className="adminStatValue">{item.value}</div>
            </div>
          ))}
          <div className="adminStatCard">
            <div className="adminStatLabel">Manifest versiyasi</div>
            <div className="adminStatValue" style={{ fontSize: 13 }}>
              {manifest?.version || "—"}
            </div>
          </div>
        </div>

        <div style={{ display: "grid", gap: 12, marginTop: 18 }}>
          <label className="adminToggleRow">
            <span className="adminToggleLabel">Ogohlantirishni ko‘rsatish</span>
            <input
              type="checkbox"
              checked={config.warningEnabled}
              onChange={(event) => setConfig((current) => ({ ...current, warningEnabled: event.target.checked }))}
            />
          </label>
          <label className="adminToggleRow">
            <span className="adminToggleLabel">Majburiy yangilash</span>
            <input
              type="checkbox"
              checked={config.forceUpdate}
              onChange={(event) => setConfig((current) => ({ ...current, forceUpdate: event.target.checked }))}
            />
          </label>
          <label className="adminToggleRow">
            <span className="adminToggleLabel">Launchda sinxronlash</span>
            <input
              type="checkbox"
              checked={config.syncOnLaunch}
              onChange={(event) => setConfig((current) => ({ ...current, syncOnLaunch: event.target.checked }))}
            />
          </label>
          <label className="adminToggleRow">
            <span className="adminToggleLabel">Video faqat online</span>
            <input
              type="checkbox"
              checked={config.videoOnlineOnly}
              onChange={(event) => setConfig((current) => ({ ...current, videoOnlineOnly: event.target.checked }))}
            />
          </label>
          <label className="adminToggleRow">
            <span className="adminToggleLabel">Audio local keshlanadi</span>
            <input
              type="checkbox"
              checked={config.audioOfflineCache}
              onChange={(event) => setConfig((current) => ({ ...current, audioOfflineCache: event.target.checked }))}
            />
          </label>
          <label className="adminToggleRow">
            <span className="adminToggleLabel">Audio pullik rejim flagi</span>
            <input
              type="checkbox"
              checked={config.audioPremiumRequired}
              onChange={(event) => setConfig((current) => ({ ...current, audioPremiumRequired: event.target.checked }))}
            />
          </label>
          <label className="adminToggleRow">
            <span className="adminToggleLabel">Video pullik rejim flagi</span>
            <input
              type="checkbox"
              checked={config.videoPremiumRequired}
              onChange={(event) => setConfig((current) => ({ ...current, videoPremiumRequired: event.target.checked }))}
            />
          </label>

          <label className="fieldStack">
            <span className="fieldLabel">Yangilash havolasi</span>
            <input
              className="input"
              value={config.updateUrl}
              onChange={(event) => setConfig((current) => ({ ...current, updateUrl: event.target.value }))}
              placeholder="https://play.google.com/..."
            />
          </label>
          <label className="fieldStack">
            <span className="fieldLabel">Android Play Store havolasi</span>
            <input
              className="input"
              value={config.updateUrlAndroid}
              onChange={(event) =>
                setConfig((current) => ({ ...current, updateUrlAndroid: event.target.value }))
              }
              placeholder="https://play.google.com/store/apps/details?id=..."
            />
          </label>
          <label className="fieldStack">
            <span className="fieldLabel">iOS App Store havolasi</span>
            <input
              className="input"
              value={config.updateUrlIos}
              onChange={(event) =>
                setConfig((current) => ({ ...current, updateUrlIos: event.target.value }))
              }
              placeholder="https://apps.apple.com/..."
            />
          </label>

          <div className="adminLocaleGrid">
            {(["uz_latn", "uz_cyrl", "ru"] as const).map((lang) => (
              <div key={lang} className="adminLocaleCard">
                <div className="adminLocaleTitle">{lang}</div>
                <label className="fieldStack">
                  <span className="fieldLabel">Sarlavha</span>
                  <input
                    className="input"
                    value={config.warning.titleI18n[lang]}
                    onChange={(event) => updateText("titleI18n", lang, event.target.value)}
                  />
                </label>
                <label className="fieldStack">
                  <span className="fieldLabel">Xabar</span>
                  <textarea
                    className="input adminTextarea"
                    rows={3}
                    value={config.warning.messageI18n[lang]}
                    onChange={(event) => updateText("messageI18n", lang, event.target.value)}
                  />
                </label>
                <label className="fieldStack">
                  <span className="fieldLabel">Tugma matni</span>
                  <input
                    className="input"
                    value={config.warning.actionLabelI18n[lang]}
                    onChange={(event) => updateText("actionLabelI18n", lang, event.target.value)}
                  />
                </label>
              </div>
            ))}
          </div>

          <div className="adminFormActions">
            <button className="btn btn-ghost" type="button" onClick={loadConfig} disabled={loading || saving}>
              <RefreshCw className="lucide" aria-hidden="true" /> Yangilash
            </button>
            <button className="btn btn-primary" type="button" onClick={save} disabled={loading || saving}>
              <Save className="lucide" aria-hidden="true" /> {saving ? "Saqlanmoqda..." : "Saqlash"}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
