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
      className="grid grid-cols-3 gap-x-8 gap-y-section border-t border-line pt-4 lg:flex-none lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0"
    >
      {stats.map((stat) => (
        <div key={stat.label} className="min-w-0">
          <dt className="text-2xs font-bold uppercase tracking-wide text-ink-3">{stat.label}</dt>
          <dd className="mt-1 break-words text-base font-bold tabular-nums text-ink">{stat.value}</dd>
        </div>
      ))}
    </dl>
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
        <p className="text-2xs font-bold uppercase tracking-wide text-ink-3">Cobertura</p>
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
  title,
  description,
  onClick,
  disabled,
}: {
  icon: React.ReactNode;
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
      className="flex h-full flex-col items-start gap-2 rounded-ctl border border-line-2 bg-paper p-3.5 text-left transition-colors hover:bg-sunken disabled:cursor-not-allowed disabled:opacity-60"
    >
      <span aria-hidden="true" className="flex h-8 w-8 items-center justify-center rounded-ctl bg-sunken text-ink-2">
        {icon}
      </span>
      <span id={`${id}-t`} className="text-sm font-bold text-ink">
        {title}
      </span>
      <span id={`${id}-d`} className="text-xs leading-snug text-ink-3-strong">
        {description}
      </span>
    </button>
  );
}
