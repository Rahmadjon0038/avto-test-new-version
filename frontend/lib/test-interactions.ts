"use client";

import { useEffect, type RefObject } from "react";

type ShortcutMode = "function" | "alpha";

type UseTestInteractionsArgs = {
  enabled: boolean;
  currentIndex: number;
  optionCount: number;
  mode: ShortcutMode;
  onSelect: (optionIndex: number) => void;
  scrollTargetRef?: RefObject<HTMLElement | null>;
};

function keyToOptionIndex(key: string, mode: ShortcutMode) {
  if (mode === "function") {
    const match = /^F(\d{1,2})$/i.exec(key);
    if (!match) return null;
    const index = Number(match[1]) - 1;
    return Number.isInteger(index) ? index : null;
  }

  if (/^[a-z]$/i.test(key)) {
    return key.toUpperCase().charCodeAt(0) - 65;
  }

  return null;
}

export function useTestInteractions({
  enabled,
  currentIndex,
  optionCount,
  mode,
  onSelect,
  scrollTargetRef
}: UseTestInteractionsArgs) {
  useEffect(() => {
    if (!enabled || !scrollTargetRef?.current) return;
    const target = scrollTargetRef.current;
    const frame = window.requestAnimationFrame(() => {
      target.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [currentIndex, enabled, scrollTargetRef]);

  useEffect(() => {
    if (!enabled) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const optionIndex = keyToOptionIndex(event.key, mode);
      if (optionIndex === null || optionIndex < 0 || optionIndex >= optionCount) return;
      event.preventDefault();
      onSelect(optionIndex);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled, mode, onSelect, optionCount]);
}
