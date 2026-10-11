/**
 * useTheme — the current theme and a way to change it.
 *
 * Reads `<html data-theme>` through `useSyncExternalStore` (a MutationObserver
 * is the subscription), so every toggle on the page — the top bar's and the
 * account menu's — stays in step without a provider, and the server snapshot
 * is always "light": the markup the server sent and the first client render
 * agree, and the real value arrives right after hydration.
 */

"use client";

import { useCallback, useSyncExternalStore } from "react";
import { THEME_ATTRIBUTE, THEME_STORAGE_KEY, applyTheme, readAppliedTheme, type ThemeName } from "@/lib/theme";

function subscribe(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: [THEME_ATTRIBUTE] });
  return (): void => observer.disconnect();
}

export function useTheme(): { theme: ThemeName; toggle: () => void } {
  const theme = useSyncExternalStore<ThemeName>(subscribe, readAppliedTheme, (): ThemeName => "light");

  const toggle = useCallback((): void => {
    const next: ThemeName = readAppliedTheme() === "dark" ? "light" : "dark";
    applyTheme(next);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Storage can be blocked; the choice still holds for this page.
    }
  }, []);

  return { theme, toggle };
}
