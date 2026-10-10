/**
 * Timeline — a day drawn along its hours: one block per session, placed and
 * sized by its real start and end.
 *
 * The same drawing serves the admin ("Hoy en el club") and the trainer ("Hoy"),
 * so it asks for nothing role-specific: items in, blocks out. Two things are
 * said at once without words:
 *
 *   - WHAT state its list is in: a sticker per status, the KPI tiles' language
 *     (2px outline, hard offset shadow, solid brand face) - coal = lista
 *     tomada, ball = en curso, red = sin lista, a dashed white sticker =
 *     pendiente. Colour is never the only carrier: every block also wears a
 *     glyph and the status word, and the state is in its accessible name;
 *   - WHEN: a coal line crosses the track at the current minute with an
 *     "Ahora" sticker, and what already happened lies flat (no shadow). A day
 *     seen outside its hours pins the chip to the edge it lies beyond.
 *
 * A header states the day's progress (ring + "N de M listas") and a legend
 * shows the four stickers in miniature. Each block is a real link when it has an `href` (the
 * session's attendance), so keyboard and screen-reader users get the same door
 * the pointer does, and its accessible name is the whole sentence the tooltip
 * shows. The hour grid behind the blocks is an `aria-hidden` SVG. On a phone
 * the track keeps a readable minimum width and scrolls sideways instead of
 * crushing the blocks.
 */

"use client";

import type { ReactElement } from "react";
import Link from "next/link";
import { Check, Clock, Play, TriangleAlert, type LucideIcon } from "lucide-react";
import { cn } from "@/components/ui";
import { ICON } from "@/lib/icon-size";
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

const LANE_HEIGHT = 68;
const LANE_GAP = 8;

/**
 * The sticker face of each state. Same recipe as the KPI slabs (`StatCard`):
 * a 2px coal outline on a solid brand fill, with the dark-mode rims the slabs
 * use (the coal slab keeps the bright rim, the saturated fills a coal one).
 * Pending is the quiet one: a white sticker with a dashed outline, so the
 * state still reads in a greyscale print.
 */
export const TIMELINE_FACE: Record<TimelineStatus, string> = {
  done: "border-edge bg-coal text-white dark:border-edge-hot dark:bg-kpi-coal",
  live: "border-edge bg-ball text-coal dark:border-edge-fill dark:bg-kpi-ball",
  missing: "border-edge bg-cata-red text-white dark:border-edge-fill dark:bg-kpi-red",
  pending: "border-dashed border-edge bg-paper text-ink",
};

const STATUS_GLYPH: Record<TimelineStatus, LucideIcon> = {
  done: Check,
  live: Play,
  missing: TriangleAlert,
  pending: Clock,
};

/** The state's glyph: the non-colour cue next to the status word. */
export function TimelineGlyph({
  status,
  className,
}: {
  status: TimelineStatus;
  className?: string;
}): ReactElement {
  const Glyph = STATUS_GLYPH[status];
  return (
    <Glyph
      aria-hidden="true"
      data-testid="timeline-glyph"
      data-glyph={status}
      size={ICON.sm}
      strokeWidth={3}
      className={cn("flex-none", className)}
    />
  );
}

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
            <b className="font-extrabold text-ink">
              {done} de {total} {total === 1 ? "lista" : "listas"}
            </b>{" "}
            {total === 1 ? "tomada" : "tomadas"}
            {live > 0 ? ` · ${live} en curso` : ""}
            {missing > 0 ? ` · ${missing} sin lista` : ""}
          </p>
        </div>
        <ul
          aria-label="Leyenda"
          className="m-0 grid min-w-[22rem] flex-1 list-none grid-cols-2 gap-x-4 gap-y-2 p-0 text-xs font-semibold text-ink sm:grid-cols-4"
        >
          {LEGEND.map((entry) => (
            <li key={entry.status} className="flex items-center gap-2">
              <span
                aria-hidden="true"
                data-testid="timeline-legend-swatch"
                data-status={entry.status}
                className={cn(
                  "flex h-6 w-8 flex-none items-center justify-center rounded-md border-2 shadow-sticker-sm",
                  TIMELINE_FACE[entry.status],
                )}
              >
                <TimelineGlyph status={entry.status} />
              </span>
              {entry.label}
            </li>
          ))}
        </ul>
      </div>

      <div role="group" aria-label={ariaLabel} className="overflow-x-auto">
        <div className="relative flex min-w-[640px] flex-col gap-1.5 pb-1 pr-1">
          <div
            aria-hidden="true"
            className="relative h-6 text-2xs font-semibold tabular-nums text-ink-3-strong"
          >
            {layout.ticks
              .filter((tick) => !(beyond === "before" && tick.percent <= 0))
              .map((tick) => (
                <span
                  key={tick.label}
                  className={cn(
                    "absolute top-1",
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
                  "absolute top-0 z-10 rounded-md border-2 border-edge bg-mark px-2 text-2xs font-extrabold uppercase leading-4 tracking-caps text-on-solid shadow-sticker-sm dark:border-edge-fill",
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
                  "group/block absolute flex min-w-0 flex-col justify-center gap-0.5 overflow-hidden rounded-ctl border-2 px-2.5 text-left",
                  "motion-safe:transition-[transform,box-shadow] hover:-translate-x-px hover:-translate-y-px hover:shadow-sticker motion-reduce:transition-none motion-reduce:hover:translate-x-0 motion-reduce:hover:translate-y-0",
                  TIMELINE_FACE[block.item.status],
                  // What already happened lies flat; what is still ahead stands off the track.
                  past ? "shadow-none" : "shadow-sticker-sm",
                ),
                style: {
                  left: `calc(${block.leftPercent}% + 1px)`,
                  width: `calc(${block.widthPercent}% - 5px)`,
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
                  <span className="flex min-w-0 items-center gap-1.5">
                    <TimelineGlyph status={block.item.status} />
                    <b className="block truncate text-xs font-extrabold tabular-nums">
                      {block.item.start} – {block.item.end}
                    </b>
                  </span>
                  <span className="block truncate text-xs font-semibold">
                    {block.item.title}
                  </span>
                  <span
                    data-testid="timeline-block-status"
                    className="block truncate text-2xs font-bold uppercase tracking-caps"
                  >
                    {block.item.statusLabel}
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
                className="pointer-events-none absolute -bottom-1 -top-1 z-10 w-[3px] -translate-x-1/2 rounded-full bg-mark ring-1 ring-paper"
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
