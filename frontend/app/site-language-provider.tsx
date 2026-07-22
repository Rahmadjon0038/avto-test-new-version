"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  DEFAULT_LANGUAGE,
  getBrowserLanguage,
  getLanguageOption,
  getTranslation,
  LANGUAGE_OPTIONS,
  setBrowserLanguage,
  type LanguageCode
} from "@/lib/site-language";

type SiteLanguageContextValue = {
  language: LanguageCode;
  setLanguage: (next: LanguageCode) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
  options: typeof LANGUAGE_OPTIONS;
  currentOption: ReturnType<typeof getLanguageOption>;
};

const SiteLanguageContext = createContext<SiteLanguageContextValue | null>(null);

export function SiteLanguageProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [language, setLanguageState] = useState<LanguageCode>(DEFAULT_LANGUAGE);

  useEffect(() => {
    const initial = getBrowserLanguage();
    setBrowserLanguage(initial);
    setLanguageState(initial);
  }, []);

  const setLanguage = useCallback(
    (next: LanguageCode) => {
      const normalized = setBrowserLanguage(next);
      setLanguageState(normalized);
      router.refresh();
    },
    [router]
  );

  const t = useCallback((key: string, vars?: Record<string, string | number>) => getTranslation(language, key, vars), [language]);

  const value = useMemo(
    () => ({
      language,
      setLanguage,
      t,
      options: LANGUAGE_OPTIONS,
      currentOption: getLanguageOption(language)
    }),
    [language, setLanguage, t]
  );

  return <SiteLanguageContext.Provider value={value}>{children}</SiteLanguageContext.Provider>;
}

export function useSiteLanguage() {
  const value = useContext(SiteLanguageContext);
  if (!value) throw new Error("useSiteLanguage must be used within SiteLanguageProvider");
  return value;
}
