"use client";

/**
 * Small presentational pieces of /profile shared by its cards: the section
 * header and the day count. Pure UI — every value arrives as a prop.
 */

import { cn } from "@/components/ui";
import type { UserRole } from "@/types/domain";

/**
 * Accent palette for the section cards: a tinted icon tile and a matching wash
 * behind the card header. Every value is an existing token — the club's ball
 * and red, the state hues and the per-account hues the dashboards already use.
 */
export type AccentTone = "ball" | "red" | "ok" | "info" | "trainer" | "warn" | "neutral" | "coal";

const ACCENT: Record<AccentTone, { tile: string; wash: string }> = {
  ball: { tile: "bg-ball text-coal", wash: "bg-ball/10" },
  red: { tile: "bg-cata-red text-white", wash: "bg-cata-red/5" },
  ok: { tile: "bg-state-ok-bg text-state-ok", wash: "bg-state-ok-bg/60" },
  info: { tile: "bg-cuenta-representante-bg text-cuenta-representante", wash: "bg-cuenta-representante-bg/60" },
  trainer: { tile: "bg-cuenta-entrenador-bg text-cuenta-entrenador", wash: "bg-cuenta-entrenador-bg/60" },
  warn: { tile: "bg-state-warn-bg text-state-warn", wash: "bg-state-warn-bg/60" },
  neutral: { tile: "bg-state-neutral-bg text-state-neutral", wash: "bg-sunken" },
  coal: { tile: "bg-ball text-coal", wash: "bg-coal" },
};

/** The rounded icon tile on its own, for rows and shortcut links. */
export function IconTile({ icon, tone }: { icon: React.ReactNode; tone: AccentTone }): React.ReactElement {
  return (
    <span
      aria-hidden="true"
      className={cn("flex h-9 w-9 flex-none items-center justify-center rounded-ctl", ACCENT[tone].tile)}
    >
      {icon}
    </span>
  );
}

/** Card header: tinted wash, icon tile, display-face title and an optional caption/action. */
export function SectionHead({
  title,
  subtitle,
  icon,
  tone,
  action,
}: {
  title: string;
  subtitle?: string;
  icon: React.ReactNode;
  tone: AccentTone;
  action?: React.ReactNode;
}): React.ReactElement {
  const dark = tone === "coal";
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-field border-b px-5 py-3.5",
        dark ? "border-white/10" : "border-line",
        ACCENT[tone].wash,
      )}
    >
      <IconTile icon={icon} tone={tone} />
      <h2
        className={cn(
          "flex-1 font-display text-lg uppercase leading-tight tracking-flat",
          dark ? "text-white" : "text-ink",
        )}
      >
        {title}
      </h2>
      {subtitle && (
        <p className={cn("text-xs xl:max-2xl:hidden", dark ? "text-white/60" : "text-ink-3-strong")}>
          {subtitle}
        </p>
      )}
      {action}
    </div>
  );
}

/**
 * Whole days between today and the coverage end (negative once it lapsed).
 * Both sides are calendar dates anchored at local noon, so DST and the
 * time of day never move the count.
 */
export function daysUntil(isoEnd: string, today: Date): number {
  const end = new Date(`${isoEnd}T12:00:00`);
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 12);
  return Math.round((end.getTime() - start.getTime()) / 86_400_000);
}

/** The per-role block the right column opens with. */
export type RoleBlockKind = "ticket" | "dependants" | "trainer-board" | "admin-board" | "account-board";

/**
 * Which per-role blocks a session draws, in order. A jugador's membership
 * ticket needs a membership row to talk about; a representante who also holds
 * a membership of their own gets both («A tu cargo» leads).
 */
export function roleBlocksFor(role: UserRole, hasMembership: boolean): RoleBlockKind[] {
  switch (role) {
    case "estudiante":
      return hasMembership ? ["ticket"] : [];
    case "representante":
      return hasMembership ? ["dependants", "ticket"] : ["dependants"];
    case "trainer":
      return ["trainer-board"];
    case "admin":
      return ["admin-board"];
    case "unsupported":
      return ["account-board"];
  }
}

/** Days left at or under which the ticket warns instead of reassuring. */
export const TICKET_WARN_DAYS = 7;

export type TicketToneKey = "ok" | "warn" | "bad";

/**
 * The ticket's tone: the worse of what the coverage dates say and what the
 * membership's own status chip says, so the two never disagree on one screen.
 */
export function ticketTone(daysLeft: number | null, chipTone: "ok" | "warn" | "bad" | "neutral"): TicketToneKey {
  if (chipTone === "bad" || (daysLeft !== null && daysLeft < 0)) return "bad";
  if (chipTone === "warn" || (daysLeft !== null && daysLeft <= TICKET_WARN_DAYS)) return "warn";
  return "ok";
}

/** The one-word standing printed over the strip. */
export function ticketWord(tone: TicketToneKey, daysLeft: number | null, chipLabel: string): string {
  if (daysLeft !== null && daysLeft < 0) return "Venció";
  if (tone === "ok") return "Al día";
  if (daysLeft !== null && daysLeft <= TICKET_WARN_DAYS && chipLabel === "Membresía activa") return "Vence pronto";
  return chipLabel;
}
