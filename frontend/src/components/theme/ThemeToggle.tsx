/**
 * ThemeToggle — the visible dark-mode control (S6).
 *
 * A sun/moon icon button with a constant accessible name and `aria-pressed`
 * for the state, rather than a label that flips: "Modo oscuro, activado" reads
 * the same way every time. The icon shows what the page is NOT yet (a moon in
 * light, a sun in dark) — the thing a press will give you.
 *
 * Three variants share one behaviour: `bar` is the 40px control that sits next to
 * the notifications bell in the top bar (and on the public auth screens),
 * `menu` is the row inside the account menu, and `landing` is the same button
 * wearing the landing's sticker skin (`.landing-theme-toggle`, landing.css),
 * whose colours come from the `--landing-*` variables.
 */

"use client";

import { Moon, Sun } from "lucide-react";
import { ICON } from "@/lib/icon-size";
import { useTheme } from "./useTheme";

interface ThemeToggleProps {
  variant: "bar" | "menu" | "landing";
}

const BAR_CLASSES =
  "touch-target flex h-ctl w-10 shrink-0 items-center justify-center rounded-ctl border border-line-2 bg-paper text-ink-2 transition-colors hover:border-ink-3 hover:text-ink";

const MENU_CLASSES =
  "flex h-ctl w-full items-center gap-2.5 rounded-ctl px-3 text-sm font-semibold text-white/80 transition-colors hover:bg-white/[0.08] hover:text-white";

const VARIANT_CLASSES = { bar: BAR_CLASSES, menu: MENU_CLASSES, landing: "landing-theme-toggle" } as const;

export default function ThemeToggle({ variant }: ThemeToggleProps): React.ReactElement {
  const { theme, toggle } = useTheme();
  const dark = theme === "dark";
  const Icon = dark ? Sun : Moon;

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={dark}
      aria-label="Modo oscuro"
      title={dark ? "Cambiar a modo claro" : "Cambiar a modo oscuro"}
      className={VARIANT_CLASSES[variant]}
    >
      <Icon size={ICON.base} strokeWidth={2} aria-hidden="true" />
      {variant === "menu" ? <span>{dark ? "Modo claro" : "Modo oscuro"}</span> : null}
    </button>
  );
}
