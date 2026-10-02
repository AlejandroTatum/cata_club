/**
 * RoleShortcuts — the grid of bordered shortcut tiles ("go straight to your
 * work"): an arrow tile, a bold title and a muted description per link.
 *
 * Perfil and Ayuda both offer the same per-role destinations; this is the one
 * look for them, so every role sees the shortcuts the same way. The grid
 * fills the width of whatever card the caller puts it in.
 */

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { ReactElement } from "react";
import { ICON } from "@/lib/icon-size";
import { cn } from "./cn";

export type RoleShortcutTone = "ball" | "red" | "info" | "trainer" | "neutral";

export interface RoleShortcut {
  href: string;
  title: string;
  description: string;
}

export interface RoleShortcutsProps {
  shortcuts: readonly RoleShortcut[];
  tone?: RoleShortcutTone;
  /** Accessible name of the list. */
  label?: string;
  className?: string;
}

const TILE: Record<RoleShortcutTone, string> = {
  ball: "bg-ball text-coal",
  red: "bg-cata-red text-white",
  info: "bg-cuenta-representante-bg text-cuenta-representante",
  trainer: "bg-cuenta-entrenador-bg text-cuenta-entrenador",
  neutral: "bg-state-neutral-bg text-state-neutral",
};

export default function RoleShortcuts({
  shortcuts,
  tone = "ball",
  label,
  className,
}: RoleShortcutsProps): ReactElement {
  return (
    <ul aria-label={label} className={cn("grid gap-3 sm:grid-cols-2", className)}>
      {shortcuts.map((shortcut) => (
        <li key={shortcut.href + shortcut.title} className="flex">
          <Link
            href={shortcut.href}
            className="flex w-full items-center gap-3 rounded-ctl border border-line-2 bg-paper p-3.5 text-sm transition-colors hover:border-coal hover:bg-ball/10"
          >
            <span
              aria-hidden="true"
              className={cn("flex h-9 w-9 flex-none items-center justify-center rounded-ctl", TILE[tone])}
            >
              <ArrowRight size={ICON.sm} strokeWidth={1.5} />
            </span>
            <span className="grid min-w-0 flex-1 gap-0.5">
              <span className="font-bold text-ink">{shortcut.title}</span>
              <span className="text-xs text-ink-3-strong">{shortcut.description}</span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
