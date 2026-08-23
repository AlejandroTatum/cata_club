import type { LandingSchedule } from "./landing-config";

/** A start/end pair measured in minutes from midnight. */
export interface ClockRange {
  start: number;
  end: number;
}

/** The shared opening/closing window every bar is positioned against. */
export interface DayRange {
  start: number;
  end: number;
  /** `end - start`, the width of the whole day on the timeline scale. */
  span: number;
}

/** A bar's position on the timeline, expressed as percentages of the day span. */
export interface BarGeometry {
  left: number;
  width: number;
}

/**
 * Parses the published `"HH:MM – HH:MM"` block into minutes. The regex also
 * tolerates a single-digit hour, but the config always emits zero-padded times.
 */
export function parseClockRange(hours: string): ClockRange {
  const match = /(\d{1,2}:\d{2})\D+(\d{1,2}:\d{2})/.exec(hours);
  if (!match) return { start: 0, end: 0 };
  return { start: toMinutes(match[1]), end: toMinutes(match[2]) };
}

/** `"HH:MM"` → minutes from midnight. */
function toMinutes(hhmm: string): number {
  const [hours, minutes] = hhmm.split(":");
  return Number(hours) * 60 + Number(minutes);
}

/** Minutes from midnight → `"HH:MM"`, zero-padded. */
export function formatClock(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${hours < 10 ? "0" : ""}${hours}:${rest < 10 ? "0" : ""}${rest}`;
}

/**
 * The day's opening and closing, derived from the slots themselves rather than
 * hardcoded: adding a morning block (as the Adultos 08:00 session did) or a
 * later evening block moves these bounds on its own. Iterates every slot of
 * every category — not just the first slot per category.
 */
export function deriveDayRange(schedules: LandingSchedule[]): DayRange {
  const slots = schedules.flatMap((schedule): LandingSchedule["slots"] => schedule.slots);
  if (slots.length === 0) return { start: 0, end: 0, span: 0 };

  const start = Math.min(...slots.map((slot): number => parseClockRange(slot.hours).start));
  const end = Math.max(...slots.map((slot): number => parseClockRange(slot.hours).end));
  return { start, end, span: end - start };
}

/** A block's `left`/`width` on the shared scale, in percent. */
export function barGeometry(hours: string, range: DayRange): BarGeometry {
  const { start, end } = parseClockRange(hours);
  return {
    left: ((start - range.start) / range.span) * 100,
    width: ((end - start) / range.span) * 100,
  };
}

/**
 * The weekday track's closure, computed rather than assumed: the widest gap
 * between consecutive weekday slots, returned only when it exceeds sixty
 * minutes. Saturday-only slots are ignored — the weekday lane answers when the
 * club is closed between sessions on a normal weekday.
 */
export function closedWeekdayGap(schedules: LandingSchedule[]): ClockRange | null {
  const week = schedules
    .flatMap((schedule): LandingSchedule["slots"] => schedule.slots)
    .filter((slot): boolean => slot.on === "week")
    .map((slot): ClockRange => parseClockRange(slot.hours))
    .sort((a, b): number => a.start - b.start);

  let best: ClockRange | null = null;
  for (let i = 1; i < week.length; i += 1) {
    const previousEnd = Math.max(...week.slice(0, i).map((slot): number => slot.end));
    const gap = week[i].start - previousEnd;
    if (gap > 60 && (best === null || gap > best.end - best.start)) {
      best = { start: previousEnd, end: week[i].start };
    }
  }
  return best;
}
