"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Cog, Shuffle, Sparkles, X } from "lucide-react";

export type TestPageSettings = {
  shuffleQuestions: boolean;
  autoNext: boolean;
};

const STORAGE_KEY = "road-test:test-page-settings";
const SHUFFLE_SEED_PREFIX = "road-test:test-page-shuffle-seed";

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

export function useShuffleSeed(storageKey: string) {
  const seedStorageKey = `${SHUFFLE_SEED_PREFIX}:${storageKey}`;
  const [seed, setSeedState] = useState<number>(1);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const raw = window.sessionStorage.getItem(seedStorageKey);
    const initialSeed = raw ? Number(raw) : 0;
    const nextSeed = Number.isFinite(initialSeed) && initialSeed > 0 ? initialSeed : makeShuffleSeed();
    window.sessionStorage.setItem(seedStorageKey, String(nextSeed));
    setSeedState(nextSeed);
  }, [seedStorageKey]);

  const refreshSeed = useCallback(() => {
    const nextSeed = makeShuffleSeed();
    if (typeof window !== "undefined") {
      window.sessionStorage.setItem(seedStorageKey, String(nextSeed));
    }
    setSeedState(nextSeed);
    return nextSeed;
  }, [seedStorageKey]);

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
        title="Sozlamalar"
        aria-label="Sozlamalar"
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
                  Test sozlamalari
                </div>
                <div className="testSettingsModalSubtitle">Test yechish ko‘rinishini o‘zingizga moslang.</div>
              </div>
              <button className="testSettingsClose" type="button" aria-label="Yopish" onClick={() => setOpen(false)}>
                <X className="lucide" aria-hidden="true" />
              </button>
            </div>

            <div className="testSettingsList">
              <ToggleRow
                title="Testlarni aralashtirish"
                description="Savollar tartibi har safar aralash ko‘rinadi."
                enabled={settings.shuffleQuestions}
                onToggle={(next) => onChange({ ...settings, shuffleQuestions: next })}
                icon={<Shuffle className="lucide" aria-hidden="true" />}
              />
              <ToggleRow
                title="Avtomatik o‘tish"
                description="Javob tanlanganda keyingi savolga o‘tadi."
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
