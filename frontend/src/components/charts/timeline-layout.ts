/**
 * Pure geometry for `Timeline`: where each block of a day sits.
 *
 * The window runs from the first start to the last end and is never stretched
 * to "now" (a day that starts at 15:00 seen at 03:20 would squash every block
 * against the right edge to draw twelve empty hours). Overlapping blocks take
 * the first lane that has already freed up, so the track only grows taller when
 * sessions really are simultaneous.
 */

export type TimelineStatus = "pending" | "live" | "done" | "missing";

export interface TimelineItem {
  id: string;
  /** "HH:mm". */
  start: string;
  end: string;
  /** The group or category, e.g. "Formativo". */
  title: string;
  /** Names the group's colour; defaults to `title`. */
  group?: string;
  status: TimelineStatus;
  /** The status in words, shown in the block and read by screen readers. */
  statusLabel: string;
  /** Extra clause for the tooltip, e.g. "12 inscritos". */
  note?: string | null;
  href?: string;
}

export interface TimelineBlock {
  item: TimelineItem;
  leftPercent: number;
  widthPercent: number;
  lane: number;
}

export interface TimelineTick {
  label: string;
  percent: number;
}

export interface TimelineLayout {
  blocks: TimelineBlock[];
  lanes: number;
  ticks: TimelineTick[];
  /** 0–100, or `null` when the clock is outside the drawn window. */
  nowPercent: number | null;
  startLabel: string;
  endLabel: string;
}

export function toMinutes(hora: string): number | null {
  const match = /^(\d{1,2}):(\d{2})/.exec(hora.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours > 23 || minutes > 59 ? null : hours * 60 + minutes;
}

export function formatMinutes(total: number): string {
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/** Whole-hour ticks inside the window; every other hour once the day is long. */
function buildTicks(start: number, end: number): TimelineTick[] {
  const span = end - start;
  const step = span > 12 * 60 ? 120 : 60;
  const ticks: TimelineTick[] = [];
  for (let minute = Math.ceil(start / 60) * 60; minute <= end; minute += 60) {
    if (((minute / 60) % (step / 60)) !== 0 && minute !== start) continue;
    ticks.push({ label: formatMinutes(minute), percent: ((minute - start) / span) * 100 });
  }
  return ticks;
}

/** `null` when no item can be drawn (bad times, end before start). */
export function buildTimelineLayout(items: readonly TimelineItem[], nowMinutes: number | null): TimelineLayout | null {
  const drawable = items
    .map((item) => ({ item, start: toMinutes(item.start), end: toMinutes(item.end) }))
    .filter((row): row is { item: TimelineItem; start: number; end: number } => row.start !== null && row.end !== null && row.end > row.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  if (drawable.length === 0) return null;

  const start = drawable[0].start;
  const end = drawable.reduce((latest, row) => Math.max(latest, row.end), drawable[0].end);
  const span = end - start;

  const laneEnds: number[] = [];
  const blocks = drawable.map(({ item, start: from, end: to }): TimelineBlock => {
    const free = laneEnds.findIndex((laneEnd) => laneEnd <= from);
    const lane = free === -1 ? laneEnds.length : free;
    laneEnds[lane] = to;
    return {
      item,
      leftPercent: ((from - start) / span) * 100,
      widthPercent: ((to - from) / span) * 100,
      lane,
    };
  });

  const inside = nowMinutes !== null && nowMinutes >= start && nowMinutes <= end;
  return {
    blocks,
    lanes: laneEnds.length,
    ticks: buildTicks(start, end),
    nowPercent: inside ? (((nowMinutes as number) - start) / span) * 100 : null,
    startLabel: formatMinutes(start),
    endLabel: formatMinutes(end),
  };
}
