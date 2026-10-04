"use client";

/**
 * Small presentational pieces of /profile: hero stats, the coverage meter and
 * the security action tiles. Pure UI — every value arrives as a prop.
 */

import { useId } from "react";
import { cn } from "@/components/ui";

export interface HeroStat {
  label: string;
  value: string;
}

export function HeroStats({ stats }: { stats: readonly HeroStat[] }): React.ReactElement {
  return (
    <dl
      data-testid="profile-hero-stats"
      className="grid grid-cols-1 gap-px border-t border-white/10 bg-white/10 sm:grid-cols-3"
    >
      {stats.map((stat) => (
        <div key={stat.label} className="min-w-0 bg-coal-2 px-6 py-4 lg:px-8">
          <dt className="text-2xs font-bold uppercase tracking-wide text-white/60">{stat.label}</dt>
          <dd className="mt-1 break-words text-base font-bold tabular-nums text-ball">{stat.value}</dd>
        </div>
      ))}
    </dl>
  );
}

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

/** Days of coverage a full meter represents: one monthly payment. */
const METER_DAYS = 30;

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

export function CoverageMeter({ daysLeft }: { daysLeft: number }): React.ReactElement {
  const expired = daysLeft < 0;
  const pct = expired ? 0 : Math.min(100, Math.round((daysLeft / METER_DAYS) * 100));
  const label = expired
    ? `Venció hace ${-daysLeft} ${-daysLeft === 1 ? "día" : "días"}`
    : daysLeft === 0
      ? "Vence hoy"
      : `Quedan ${daysLeft} ${daysLeft === 1 ? "día" : "días"}`;
  const tone = expired ? "bg-state-bad" : daysLeft <= 7 ? "bg-state-warn" : "bg-state-ok";

  return (
    <div data-testid="profile-coverage" className="border-b border-line px-5 py-3">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-2xs font-bold uppercase tracking-wide text-ink-3-strong">Cobertura</p>
        <p className="text-sm font-bold tabular-nums text-ink">{label}</p>
      </div>
      <div
        role="progressbar"
        aria-label="Cobertura restante"
        aria-valuemin={0}
        aria-valuemax={METER_DAYS}
        aria-valuenow={expired ? 0 : Math.min(daysLeft, METER_DAYS)}
        aria-valuetext={label}
        className="mt-2 h-1.5 overflow-hidden rounded-full bg-line"
      >
        <div className={cn("h-full rounded-full", tone)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/**
 * One security action as a tile: icon, name and what it does. The button's
 * accessible name is the title alone; the description is its description.
 */
export function ActionTile({
  icon,
  tone = "neutral",
  title,
  description,
  onClick,
  disabled,
}: {
  icon: React.ReactNode;
  tone?: AccentTone;
  title: string;
  description: string;
  onClick: () => void;
  disabled?: boolean;
}): React.ReactElement {
  const id = useId();
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-labelledby={`${id}-t`}
      aria-describedby={`${id}-d`}
      className="flex h-full items-center gap-3 rounded-ctl border border-line-2 bg-paper p-3.5 text-left transition-colors hover:bg-sunken disabled:cursor-not-allowed disabled:opacity-60 sm:flex-col sm:items-start sm:gap-2 xl:flex-row xl:items-center xl:gap-3"
    >
      <IconTile icon={icon} tone={tone} />
      <span className="grid min-w-0 gap-0.5">
        <span id={`${id}-t`} className="text-sm font-bold text-ink">
          {title}
        </span>
        <span id={`${id}-d`} className="text-xs leading-snug text-ink-3-strong">
          {description}
        </span>
      </span>
    </button>
  );
}
