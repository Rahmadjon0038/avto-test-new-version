"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Save, ShieldAlert, MessageSquareText, Video } from "lucide-react";
import toast from "react-hot-toast";
import { useAuth } from "@/app/auth-provider";
import { jsonOrError } from "@/lib/api-authed";

type AppConfig = {
  forceUpdate: boolean;
  minAppVersionAndroid: string;
  minAppVersionIos: string;
  explanationEnabled: boolean;
  videoLessonsEnabled: boolean;
};

const emptyConfig = (): AppConfig => ({
  forceUpdate: false,
  minAppVersionAndroid: "",
  minAppVersionIos: "",
  explanationEnabled: false,
  videoLessonsEnabled: true,
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
    minAppVersionAndroid:
      typeof source.minAppVersionAndroid === "string" ? source.minAppVersionAndroid : "",
    minAppVersionIos:
      typeof source.minAppVersionIos === "string" ? source.minAppVersionIos : "",
    explanationEnabled: readBool(source.explanationEnabled, false),
    videoLessonsEnabled: readBool(source.videoLessonsEnabled, true),
  };
}

export default function AdminHomePage() {
  const { authFetch } = useAuth();
  const qc = useQueryClient();
  const [config, setConfig] = useState<AppConfig>(() => emptyConfig());

  const configQuery = useQuery({
    queryKey: ["admin-app-config"],
    queryFn: async () => jsonOrError(await authFetch("/api/admin/app-config"))
  });
  const loading = configQuery.isPending;

  // Forma holati (tahrirlanayotgan qiymatlar) serverdan kelgan sozlamadan to'ldiriladi.
  useEffect(() => {
    if (configQuery.data) setConfig(readConfig(configQuery.data.appConfig));
  }, [configQuery.data]);

  useEffect(() => {
    if (configQuery.error) toast.error((configQuery.error as any)?.message || "Sozlamalar yuklanmadi");
  }, [configQuery.error]);

  const saveMutation = useMutation({
    mutationFn: async () =>
      jsonOrError(
        await authFetch("/api/admin/app-config", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            forceUpdate: config.forceUpdate,
            minAppVersionAndroid: config.minAppVersionAndroid,
            minAppVersionIos: config.minAppVersionIos,
            explanationEnabled: config.explanationEnabled,
            videoLessonsEnabled: config.videoLessonsEnabled
          })
        })
      ),
    onSuccess: (data) => {
      qc.setQueryData(["admin-app-config"], data);
      setConfig(readConfig(data.appConfig));
      toast.success("Saqlandi");
    },
    onError: (error: any) => toast.error(error?.message || "Saqlab bo‘lmadi")
  });
  const saving = saveMutation.isPending;
  const save = () => saveMutation.mutate();

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

          <label className="adminFieldRow">
            <span className="adminToggleLabel">Android minimum versiya</span>
            <input
              className="adminTextInput"
              type="text"
              value={config.minAppVersionAndroid}
              placeholder="Masalan: 1.0.0+12"
              onChange={(event) =>
                setConfig((current) => ({
                  ...current,
                  minAppVersionAndroid: event.target.value,
                }))
              }
            />
          </label>

          <label className="adminFieldRow">
            <span className="adminToggleLabel">iOS minimum versiya</span>
            <input
              className="adminTextInput"
              type="text"
              value={config.minAppVersionIos}
              placeholder="Masalan: 1.0.0+12"
              onChange={(event) =>
                setConfig((current) => ({
                  ...current,
                  minAppVersionIos: event.target.value,
                }))
              }
            />
          </label>

          <div className="adminFormActions">
            <button className="btn btn-ghost" type="button" onClick={() => void configQuery.refetch()} disabled={loading || saving}>
              Yangilash
            </button>
            <button className="btn btn-primary" type="button" onClick={save} disabled={loading || saving}>
              <Save className="lucide" aria-hidden="true" /> {saving ? "Saqlanmoqda..." : "Saqlash"}
            </button>
          </div>
        </div>
      </div>

      <div className="adminPanelCard card">
        <div className="adminPanelCardHead">
          <div className="adminPanelCardTitle">
            <MessageSquareText className="lucide" aria-hidden="true" /> Savol izohi
          </div>
          <div className="adminPanelCardDesc">
            Yoqilsa, javob izohi foydalanuvchilarga ham ko‘rinadi. O‘chirilganda izoh faqat admin panelda ko‘rinadi.
          </div>
        </div>

        <div style={{ display: "grid", gap: 12, marginTop: 18 }}>
          <label className="adminToggleRow">
            <span className="adminToggleLabel">Izohni foydalanuvchilarga ko‘rsatish</span>
            <input
              type="checkbox"
              checked={config.explanationEnabled}
              onChange={(event) =>
                setConfig((current) => ({ ...current, explanationEnabled: event.target.checked }))
              }
            />
          </label>

          <div className="adminFormActions">
            <button className="btn btn-ghost" type="button" onClick={() => void configQuery.refetch()} disabled={loading || saving}>
              Yangilash
            </button>
            <button className="btn btn-primary" type="button" onClick={save} disabled={loading || saving}>
              <Save className="lucide" aria-hidden="true" /> {saving ? "Saqlanmoqda..." : "Saqlash"}
            </button>
          </div>
        </div>
      </div>

      <div className="adminPanelCard card">
        <div className="adminPanelCardHead">
          <div className="adminPanelCardTitle">
            <Video className="lucide" aria-hidden="true" /> Video darslar
          </div>
          <div className="adminPanelCardDesc">
            O‘chirilsa, mobil ilovaning bosh sahifasida «Video darsliklar» bo‘limi ko‘rinmaydi. Yoqilsa, yana paydo bo‘ladi.
          </div>
        </div>

        <div style={{ display: "grid", gap: 12, marginTop: 18 }}>
          <label className="adminToggleRow">
            <span className="adminToggleLabel">Mobil ilovada video darslarni ko‘rsatish</span>
            <input
              type="checkbox"
              checked={config.videoLessonsEnabled}
              onChange={(event) =>
                setConfig((current) => ({ ...current, videoLessonsEnabled: event.target.checked }))
              }
            />
          </label>

          <div className="adminFormActions">
            <button className="btn btn-ghost" type="button" onClick={() => void configQuery.refetch()} disabled={loading || saving}>
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
