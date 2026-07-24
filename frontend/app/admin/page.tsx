"use client";

import { useEffect, useState } from "react";
import { Save, ShieldAlert } from "lucide-react";
import toast from "react-hot-toast";
import { useAuth } from "@/app/auth-provider";
import { jsonOrError } from "@/lib/api-authed";

type AppConfig = {
  forceUpdate: boolean;
};

const emptyConfig = (): AppConfig => ({
  forceUpdate: false,
});

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
  const source = value && typeof value === "object" ? value : {};
  return {
    forceUpdate: readBool(source.forceUpdate, false),
  };
}

export default function AdminHomePage() {
  const { authFetch } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [config, setConfig] = useState<AppConfig>(() => emptyConfig());

  const loadConfig = async () => {
    setLoading(true);
    try {
      const res = await authFetch("/api/admin/app-config");
      const data = await jsonOrError(res);
      setConfig(readConfig(data.appConfig));
    } catch (error: any) {
      toast.error(error?.message || "Sozlamalar yuklanmadi");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadConfig();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async () => {
    try {
      setSaving(true);
      const res = await authFetch("/api/admin/app-config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          forceUpdate: config.forceUpdate,
        }),
      });
      const data = await jsonOrError(res);
      setConfig(readConfig(data.appConfig));
      toast.success("Saqlandi");
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
            Faqat majburiy yangilashni boshqarish uchun sodda sozlama.
          </div>
        </div>

        <div style={{ display: "grid", gap: 12, marginTop: 18 }}>
          <label className="adminToggleRow">
            <span className="adminToggleLabel">Majburiy yangilash</span>
            <input
              type="checkbox"
              checked={config.forceUpdate}
              onChange={(event) =>
                setConfig((current) => ({ ...current, forceUpdate: event.target.checked }))
              }
            />
          </label>

          <div className="adminFormActions">
            <button className="btn btn-ghost" type="button" onClick={loadConfig} disabled={loading || saving}>
              Yangilash
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
