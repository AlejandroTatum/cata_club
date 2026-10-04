/**
 * The attendance goal behind every attendance tile (EXTRA redesign): at or
 * above it the tile reads green, under it amber. Amber, not red — a rate under
 * the goal is something to watch, not a failure the club has judged. The
 * word travels with the colour so the tone never carries the meaning alone.
 */

import type { StatCardTone } from "@/components/ui/StatCard";

export const ATTENDANCE_GOAL_PERCENT = 75;

export interface AttendanceTone {
  tone: Extract<StatCardTone, "ok" | "warn" | "info">;
  status: string;
}

/** `percent` is 0–100, or `null` while nobody has taken attendance yet. */
export function attendanceTone(percent: number | null): AttendanceTone {
  if (percent === null) return { tone: "info", status: "Aún sin lista" };
  if (percent >= ATTENDANCE_GOAL_PERCENT) return { tone: "ok", status: "Buen ritmo" };
  return { tone: "warn", status: `Bajo la meta de ${ATTENDANCE_GOAL_PERCENT}%` };
}
