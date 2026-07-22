"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Cog, Shuffle, Sparkles, X } from "lucide-react";
import { useSiteLanguage } from "@/app/site-language-provider";

export type TestPageSettings = {
  shuffleQuestions: boolean;
  autoNext: boolean;
};

const STORAGE_KEY = "road-test:test-page-settings";
const DEFAULT_SETTINGS: TestPageSettings = {
  shuffleQuestions: false,
  autoNext: true
};

function readStoredSettings() {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return DEFAULT_SETTINGS;
  try {
    const parsed = JSON.parse(raw) as Partial<TestPageSettings>;
    return {
      shuffleQuestions: Boolean(parsed.shuffleQuestions),
      autoNext: parsed.autoNext !== false
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function writeStoredSettings(settings: TestPageSettings) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

function makeShuffleSeed() {
  const cryptoObject = typeof window !== "undefined" ? window.crypto : undefined;
  if (cryptoObject?.getRandomValues) {
    const buffer = new Uint32Array(1);
    cryptoObject.getRandomValues(buffer);
    return buffer[0] || 1;
  }
  return Math.floor(Math.random() * 0xffffffff) || 1;
}

export function useShuffleSeed(_storageKey: string) {
  const [seed, setSeedState] = useState<number>(() => makeShuffleSeed());

  const refreshSeed = useCallback(() => {
    const nextSeed = makeShuffleSeed();
    setSeedState(nextSeed);
    return nextSeed;
  }, []);

  return { seed, refreshSeed };
}

export function useTestPageSettings() {
  const [settings, setSettingsState] = useState<TestPageSettings>(DEFAULT_SETTINGS);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setSettingsState(readStoredSettings());
    setReady(true);
  }, []);

  const setSettings = useCallback((next: TestPageSettings | ((prev: TestPageSettings) => TestPageSettings)) => {
    setSettingsState((prev) => {
      const resolved = typeof next === "function" ? next(prev) : next;
      writeStoredSettings(resolved);
      return resolved;
    });
  }, []);

  const patchSettings = useCallback((patch: Partial<TestPageSettings>) => {
    setSettings((prev) => ({ ...prev, ...patch }));
  }, [setSettings]);

  return { settings, setSettings, patchSettings, ready };
}

type ToggleRowProps = {
  title: string;
  description: string;
  enabled: boolean;
  onToggle: (next: boolean) => void;
  icon: ReactNode;
};

function ToggleRow({ title, description, enabled, onToggle, icon }: ToggleRowProps) {
  return (
    <button className={`testSettingsRow ${enabled ? "isActive" : ""}`} type="button" onClick={() => onToggle(!enabled)}>
      <span className="testSettingsRowIcon">{icon}</span>
      <span className="testSettingsRowBody">
        <span className="testSettingsRowTitle">{title}</span>
        <span className="testSettingsRowDesc">{description}</span>
      </span>
      <span className={`testSettingsSwitch ${enabled ? "isOn" : ""}`} aria-hidden="true">
        <span className="testSettingsSwitchKnob" />
      </span>
    </button>
  );
}

type TestPageSettingsButtonProps = {
  settings: TestPageSettings;
  onChange: (next: TestPageSettings) => void;
  className?: string;
};

export function TestPageSettingsButton({ settings, onChange, className }: TestPageSettingsButtonProps) {
  const [open, setOpen] = useState(false);
  const { t } = useSiteLanguage();

  const dialogId = useMemo(() => `test-settings-${Math.random().toString(36).slice(2, 8)}`, []);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <>
      <button
        className={["testSettingsTrigger", className].filter(Boolean).join(" ")}
        type="button"
        title={t("nav.profile")}
        aria-label={t("nav.profile")}
        onClick={() => setOpen(true)}
      >
        <Cog className="lucide" aria-hidden="true" />
      </button>

      {open ? (
        <div className="testSettingsOverlay" role="presentation" onClick={() => setOpen(false)}>
          <div
            className="testSettingsModal card"
            role="dialog"
            aria-modal="true"
            aria-labelledby={dialogId}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="testSettingsModalHeader">
              <div>
                <div id={dialogId} className="testSettingsModalTitle">
                  {t("settings.title")}
                </div>
                <div className="testSettingsModalSubtitle">{t("settings.subtitle")}</div>
              </div>
              <button className="testSettingsClose" type="button" aria-label="Yopish" onClick={() => setOpen(false)}>
                <X className="lucide" aria-hidden="true" />
              </button>
            </div>

            <div className="testSettingsList">
              <ToggleRow
                title={t("settings.shuffleTitle")}
                description={t("settings.shuffleDesc")}
                enabled={settings.shuffleQuestions}
                onToggle={(next) => onChange({ ...settings, shuffleQuestions: next })}
                icon={<Shuffle className="lucide" aria-hidden="true" />}
              />
              <ToggleRow
                title={t("settings.autoNextTitle")}
                description={t("settings.autoNextDesc")}
                enabled={settings.autoNext}
                onToggle={(next) => onChange({ ...settings, autoNext: next })}
                icon={<Sparkles className="lucide" aria-hidden="true" />}
              />
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

export function shuffleQuestions<T extends { id: string }>(questions: T[]) {
  return shuffleQuestionsWithSeed(questions, makeShuffleSeed());
}

export function shuffleQuestionsWithSeed<T extends { id: string }>(questions: T[], seedValue: number) {
  const items = [...questions];
  let seed = Number.isFinite(seedValue) && seedValue > 0 ? seedValue >>> 0 : 1;
  const random = () => {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let value = seed;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };

  for (let index = items.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(random() * (index + 1));
    [items[index], items[randomIndex]] = [items[randomIndex], items[index]];
  }
  return items;
}

export function shuffleQuestionOptionsWithSeed<T extends { id: string; options: string[]; correctIndex: number }>(
  question: T,
  seedValue: number
) {
  if (!Array.isArray(question.options) || question.options.length < 2) {
    return question;
  }

  const entries = question.options.map((option, index) => ({ option, index }));
  const shuffled = shuffleArrayWithSeed(entries, seedValue ^ stableHash(question.id));
  const options = shuffled.map((entry) => entry.option);
  const correctIndex = shuffled.findIndex((entry) => entry.index === question.correctIndex);

  return {
    ...question,
    options,
    correctIndex: correctIndex >= 0 ? correctIndex : 0
  };
}

function stableHash(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }
  return hash >>> 0;
}

function shuffleArrayWithSeed<T>(items: T[], seedValue: number) {
  const result = [...items];
  let seed = Number.isFinite(seedValue) && seedValue > 0 ? seedValue >>> 0 : 1;
  const random = () => {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let value = seed;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };

  for (let index = result.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(random() * (index + 1));
    [result[index], result[randomIndex]] = [result[randomIndex], result[index]];
  }

  return result;
}
