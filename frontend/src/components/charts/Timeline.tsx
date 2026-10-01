/**
 * Timeline — a day drawn along its hours: one block per session, placed and
 * sized by its real start and end.
 *
 * The same drawing serves the admin ("Hoy en el club") and the trainer ("Hoy"),
 * so it asks for nothing role-specific: items in, blocks out. Two things are
 * said at once without words:
 *
 *   - WHAT state its list is in: a soft pastel fill by status (green = lista
 *     tomada, blue = en curso, lavender = pendiente, rose = sin lista). The
 *     state is also in each block's accessible name, so colour is never the
 *     only carrier;
 *   - WHEN: a line crosses the track at the current minute with its time, and
 *     what already happened is muted. A day seen outside its hours pins the
 *     "Ahora" chip to the edge it lies beyond.
 *
 * A header states the day's progress (ring + "N de M listas") and a legend
 * explains the fills. Each block is a real link when it has an `href` (the
 * session's attendance), so keyboard and screen-reader users get the same door
 * the pointer does, and its accessible name is the whole sentence the tooltip
 * shows. The hour grid behind the blocks is an `aria-hidden` SVG. On a phone
 * the track keeps a readable minimum width and scrolls sideways instead of
 * crushing the blocks.
 */

"use client";

import type { ReactElement } from "react";
import Link from "next/link";
import { cn } from "@/components/ui";
import ChartTooltip from "./ChartTooltip";
import Ring from "./Ring";
import { useActiveIndex } from "./chart-utils";
import {
  buildTimelineLayout,
  formatMinutes,
  toMinutes,
  type TimelineBlock,
  type TimelineItem,
  type TimelineStatus,
} from "./timeline-layout";

export type { TimelineItem, TimelineStatus } from "./timeline-layout";

export interface TimelineProps {
  items: readonly TimelineItem[];
  /** Minutes since midnight in the club's clock, or `null` to draw no marker. */
  nowMinutes: number | null;
  /** One-line summary, e.g. "Clases de hoy: 5 sesiones entre 15:00 y 21:15". */
  ariaLabel: string;
  className?: string;
}

const LANE_HEIGHT = 64;
const LANE_GAP = 6;

/** Hairline border in a deeper tint of the state's hue. */
const STATUS_BORDER: Record<TimelineStatus, string> = {
  done: "border-state-ok/30",
  live: "border-cuenta-representante/30",
  pending: "border-cuenta-menor/25",
  missing: "border-state-bad/30",
};

/** Soft pastel tint by state; always laid over an opaque `bg-paper` base. */
const STATUS_TINT: Record<TimelineStatus, string> = {
  done: "bg-state-ok/15",
  live: "bg-cuenta-representante/15",
  pending: "bg-cuenta-menor/10",
  missing: "bg-state-bad/15",
};

function sentence(item: TimelineItem): string {
  return [
    `${item.title}`,
    `${item.start} a ${item.end}`,
    item.statusLabel,
    item.note,
  ]
    .filter(Boolean)
    .join(", ");
}

const LEGEND: { status: TimelineStatus; label: string }[] = [
  { status: "done", label: "Lista tomada" },
  { status: "live", label: "En curso" },
  { status: "pending", label: "Pendiente" },
  { status: "missing", label: "Sin lista" },
];

/** Share of the track the chip needs on each side of the line before it would overflow. */
const NOW_LABEL_EDGE_PERCENT = 14;

/** Where the chip sits against the now-line so it never overflows the track. */
export function nowLabelAlign(percent: number | null): "start" | "center" | "end" | null {
  if (percent === null) return null;
  if (percent < NOW_LABEL_EDGE_PERCENT) return "start";
  if (percent > 100 - NOW_LABEL_EDGE_PERCENT) return "end";
  return "center";
}

export default function Timeline({
  items,
  nowMinutes,
  ariaLabel,
  className,
}: TimelineProps): ReactElement | null {
  const { active, show, hide } = useActiveIndex();
  const layout = buildTimelineLayout(items, nowMinutes);
  if (!layout) return null;

  const trackHeight =
    layout.lanes * LANE_HEIGHT + (layout.lanes - 1) * LANE_GAP;
  const activeBlock: TimelineBlock | undefined =
    active !== null ? layout.blocks[active] : undefined;

  const total = layout.blocks.length;
  const count = (status: TimelineStatus): number =>
    layout.blocks.filter((block) => block.item.status === status).length;
  const done = count("done");
  const live = count("live");
  const missing = count("missing");

  const nowText = nowMinutes === null ? null : formatMinutes(nowMinutes);
  const startMinutes = toMinutes(layout.startLabel) ?? 0;
  // The clock lies outside the drawn window: pin the chip to the edge it lies beyond.
  const beyond: "before" | "after" | null =
    layout.nowPercent !== null || nowMinutes === null
      ? null
      : nowMinutes < startMinutes
        ? "before"
        : "after";

  const nowAlign = nowLabelAlign(layout.nowPercent);

  return (
    <div
      data-testid="timeline"
      className={cn("flex flex-col gap-3", className)}
    >
      <div data-testid="timeline-summary" className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="flex items-center gap-3">
          <Ring value={done} total={total} label="Listas tomadas hoy" />
          <p className="m-0 text-sm text-ink-2">
            <b className="font-semibold text-ink">
              {done} de {total} {total === 1 ? "lista" : "listas"}
            </b>{" "}
            {total === 1 ? "tomada" : "tomadas"}
            {live > 0 ? ` · ${live} en curso` : ""}
            {missing > 0 ? ` · ${missing} sin lista` : ""}
          </p>
        </div>
        <ul
          aria-label="Leyenda"
          className="m-0 grid min-w-[22rem] flex-1 list-none grid-cols-2 gap-x-4 gap-y-1.5 p-0 text-xs text-ink-2 sm:grid-cols-4"
        >
          {LEGEND.map((entry) => (
            <li key={entry.status} className="flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className={cn("h-3 w-5 flex-none rounded border bg-paper", STATUS_BORDER[entry.status])}
              >
                <span className={cn("block h-full w-full rounded-[inherit]", STATUS_TINT[entry.status])} />
              </span>
              {entry.label}
            </li>
          ))}
        </ul>
      </div>

      <div role="group" aria-label={ariaLabel} className="overflow-x-auto">
        <div className="relative flex min-w-[640px] flex-col gap-1.5">
          <div
            aria-hidden="true"
            className="relative h-5 text-2xs font-semibold tabular-nums text-ink-3-strong"
          >
            {layout.ticks
              .filter((tick) => !(beyond === "before" && tick.percent <= 0))
              .map((tick) => (
                <span
                  key={tick.label}
                  className={cn(
                    "absolute top-0.5",
                    tick.percent <= 0
                      ? ""
                      : tick.percent >= 100
                        ? "-translate-x-full"
                        : "-translate-x-1/2",
                  )}
                  style={{ left: `${tick.percent}%` }}
                >
                  {tick.label}
                </span>
              ))}
            {nowText !== null && (layout.nowPercent !== null || beyond) && (
              <span
                data-testid="timeline-now-label"
                data-align={nowAlign ?? undefined}
                className={cn(
                  "absolute top-0 z-10 rounded-full bg-state-bad px-2 py-px font-bold text-white",
                  layout.nowPercent !== null
                    ? nowAlign === "start"
                      ? ""
                      : nowAlign === "end"
                        ? "-translate-x-full"
                        : "-translate-x-1/2"
                    : beyond === "after"
                      ? "right-0"
                      : "left-0",
                )}
                style={
                  layout.nowPercent !== null
                    ? { left: `${layout.nowPercent}%` }
                    : undefined
                }
              >
                {beyond === "before"
                  ? `Ahora ${nowText} ▸`
                  : beyond === "after"
                    ? `◂ Ahora ${nowText}`
                    : `Ahora ${nowText}`}
              </span>
            )}
          </div>

          <div className="relative" style={{ height: trackHeight }}>
            <svg aria-hidden="true" className="absolute inset-0 h-full w-full">
              {layout.ticks.map((tick) => (
                <line
                  key={tick.label}
                  x1={`${tick.percent}%`}
                  x2={`${tick.percent}%`}
                  y1="0"
                  y2="100%"
                  className="stroke-line-2"
                />
              ))}
            </svg>

            {layout.blocks.map((block, index) => {
              const group = block.item.group ?? block.item.title;
              const end = toMinutes(block.item.end);
              const past =
                nowMinutes !== null && end !== null && end <= nowMinutes;
              const shared = {
                "aria-label": sentence(block.item),
                "data-testid": "timeline-block",
                "data-status": block.item.status,
                "data-group": group,
                className: cn(
                  "group/block absolute flex flex-col justify-center gap-0.5 overflow-hidden rounded-xl border bg-paper px-2.5 text-left text-ink",
                  STATUS_BORDER[block.item.status],
                ),
                style: {
                  left: `calc(${block.leftPercent}% + 1px)`,
                  width: `calc(${block.widthPercent}% - 2px)`,
                  top: block.lane * (LANE_HEIGHT + LANE_GAP),
                  height: LANE_HEIGHT,
                },
                onMouseEnter: () => show(index),
                onMouseLeave: () => hide(index),
                onFocus: () => show(index),
                onBlur: () => hide(index),
              };
              const body = (
                <>
                  <span
                    aria-hidden="true"
                    className={cn("absolute inset-0", STATUS_TINT[block.item.status])}
                  />
                  <span
                    className={cn(
                      "relative flex flex-col gap-0.5 motion-safe:transition-opacity",
                      past && "opacity-70 group-hover/block:opacity-100",
                    )}
                  >
                    <b className="block truncate text-xs font-bold tabular-nums">
                      {block.item.start} – {block.item.end}
                    </b>
                    <span className="block truncate text-xs font-semibold">
                      {block.item.title}
                    </span>
                  </span>
                </>
              );
              return block.item.href ? (
                <Link key={block.item.id} href={block.item.href} {...shared}>
                  {body}
                </Link>
              ) : (
                <div key={block.item.id} role="img" tabIndex={0} {...shared}>
                  {body}
                </div>
              );
            })}

            {layout.nowPercent !== null && (
              <span
                data-testid="timeline-now"
                aria-hidden="true"
                className="pointer-events-none absolute -bottom-1 -top-1 z-10 w-0.5 -translate-x-1/2 rounded-full bg-state-bad"
                style={{ left: `${layout.nowPercent}%` }}
              />
            )}
          </div>

          {activeBlock && (
            <ChartTooltip
              left={`${Math.min(82, Math.max(18, activeBlock.leftPercent + activeBlock.widthPercent / 2))}%`}
              className="top-5"
            >
              <span className="block font-bold">{activeBlock.item.title}</span>
              <span className="block tabular-nums">
                {activeBlock.item.start} – {activeBlock.item.end} ·{" "}
                {activeBlock.item.statusLabel}
              </span>
              {activeBlock.item.note && (
                <span className="block">{activeBlock.item.note}</span>
              )}
            </ChartTooltip>
          )}
        </div>
      </div>
    </div>
  );
}
