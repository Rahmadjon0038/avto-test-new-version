"use client";

import { useEffect } from "react";

type ArrowQuestionNavigationOptions = {
  enabled?: boolean;
  onPrevious: () => void;
  onNext: () => void;
};

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tagName = target.tagName.toLowerCase();
  return tagName === "input" || tagName === "textarea" || tagName === "select";
}

export function useArrowQuestionNavigation({
  enabled = true,
  onPrevious,
  onNext
}: ArrowQuestionNavigationOptions) {
  useEffect(() => {
    if (!enabled) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      if (isEditableTarget(event.target)) return;

      if (event.key === "ArrowLeft") {
        onPrevious();
      } else {
        onNext();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled, onNext, onPrevious]);
}
