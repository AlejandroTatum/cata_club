/**
 * Pure helpers for "Actividad del club": number and time formatting, the
 * thresholds that turn a reading into a tone, and the plain-language copy of
 * the system status.
 *
 * Numbers and dates are spelled from tables rather than `Intl`, so the output
 * does not change with the ICU build the runner ships (same rule as
 * `components/dashboard/context-line.ts`).
 */

import type { ChartTone } from "@/components/charts";
import type { HealthComponentKey, HealthLevel, PeriodSpan, StatusKey, SystemHealth, Tone } from "./actividad-types";

export type ActivityView = "resumen" | "avanzadas";

/** `?vista=` → view. Anything unknown is the summary, the default. */
export function parseView(param: string | null): ActivityView {
  return param === "avanzadas" ? "avanzadas" : "resumen";
}

// --- Numbers ---------------------------------------------------------------

/** 1234 → "1.234". */
export function formatCount(value: number): string {
  return Math.round(value).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/** 0.25 → "0,3" (decimal comma, fixed digits). */
export function formatDecimal(value: number, digits: number): string {
  const [whole, fraction] = value.toFixed(digits).split(".");
  return fraction ? `${formatCount(Number(whole))},${fraction}` : formatCount(Number(whole));
}

/** 248 → "248 MB"; 1536 → "1,5 GB". */
export function formatMegabytes(mb: number): string {
  if (mb < 1024) return `${formatCount(mb)} MB`;
  const gb = formatDecimal(mb / 1024, 1);
  return `${gb.replace(/,0$/, "")} GB`;
}

/** Whole-number percentage of a part; an empty whole is 0, not NaN. */
export function shareOf(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 100) : 0;
}

/** A duration in minutes: "4 min", "1 h", "2 h 5 min". */
export function formatAge(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

// --- Missing readings ------------------------------------------------------

/** What a figure that was never measured reads as. Never "0": that would be a claim. */
export const NO_READING = "—";

export function formatOrDash(value: number | null, format: (value: number) => string = formatCount): string {
  return value === null ? NO_READING : format(value);
}

/** The newest value of a series; `null` when that point has no reading (or the series is empty). */
export function lastReading(values: readonly (number | null)[]): number | null {
  return values.length === 0 ? null : values[values.length - 1];
}

/** `shareOf` for figures that may be missing: no figure, no percentage. */
export function shareOrNull(part: number | null, whole: number | null): number | null {
  return part === null || whole === null ? null : shareOf(part, whole);
}

// --- Freshness -------------------------------------------------------------

/** Whole minutes from `fromIso` to `nowIso`, never negative. */
export function minutesBetween(fromIso: string, nowIso: string): number {
  return Math.max(0, Math.floor((Date.parse(nowIso) - Date.parse(fromIso)) / 60000));
}

/** A snapshot older than this (the collector runs every minute) is flagged. */
export const STALE_AFTER_MINUTES = 3;

export function isStale(updatedAtIso: string, nowIso: string): boolean {
  return minutesBetween(updatedAtIso, nowIso) > STALE_AFTER_MINUTES;
}

export function formatUpdatedAgo(minutes: number): string {
  if (minutes < 1) return "Actualizado ahora";
  if (minutes < 60) return `Actualizado hace ${minutes} min`;
  return `Actualizado hace ${Math.floor(minutes / 60)} h`;
}

// --- Tones -----------------------------------------------------------------

export interface Thresholds {
  warn: number;
  bad: number;
}

/** ok below `warn`, warn from `warn`, bad from `bad`. */
export function toneForThresholds(value: number | null, limits: Thresholds): Tone {
  if (value === null) return "ok";
  if (value >= limits.bad) return "bad";
  if (value >= limits.warn) return "warn";
  return "ok";
}

/** Percent-of-capacity readings (CPU, RAM, disk, connections, container memory). */
export const CAPACITY_LIMITS: Thresholds = { warn: 80, bad: 90 };
/** Share of requests answered with a server error. */
export const ERROR_5XX_LIMITS: Thresholds = { warn: 1, bad: 5 };
/** Share of requests rejected by the client (4xx) — noisy by nature, so it only warns late. */
export const ERROR_4XX_LIMITS: Thresholds = { warn: 10, bad: 25 };
/** Response time at the 95th percentile, in milliseconds. */
export const LATENCY_P95_LIMITS: Thresholds = { warn: 800, bad: 1500 };
/** The same, per endpoint: a single route may be slower than the service as a whole. */
export const ENDPOINT_P95_LIMITS: Thresholds = { warn: 1000, bad: 2000 };
/** Age in minutes of the oldest waiting notification. */
export const NOTIFICATION_AGE_LIMITS: Thresholds = { warn: 30, bad: 120 };

/** Swap growing by at least this many MB across the window is a warning. */
export const SWAP_GROWTH_WARN_MB = 20;

export function swapTone(values: readonly (number | null)[]): "ok" | "warn" {
  const readings = values.filter((value): value is number => value !== null);
  if (readings.length < 2) return "ok";
  return readings[readings.length - 1] - readings[0] >= SWAP_GROWTH_WARN_MB ? "warn" : "ok";
}

/** Maps a health level to a chart tone (the same words, one is for pills and one for SVG). */
export function chartTone(level: HealthLevel): ChartTone {
  return level === "unknown" ? "neutral" : level;
}

// --- Dates and points ------------------------------------------------------

const WEEKDAYS_SHORT = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"] as const;
const WEEKDAYS_LONG = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"] as const;
const MONTHS_LONG = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
] as const;

interface ClubDate {
  year: number;
  month: number;
  day: number;
  hour: number;
}

/** Reads the wall-clock parts straight off an ISO string written in the club's offset. */
function clubParts(iso: string): ClubDate {
  const [, y, m, d, h] = /^(\d{4})-(\d{2})-(\d{2})T(\d{2})/.exec(iso) ?? [];
  return { year: Number(y), month: Number(m), day: Number(d), hour: Number(h) };
}

function addDays(date: ClubDate, days: number): ClubDate {
  const moved = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return { year: moved.getUTCFullYear(), month: moved.getUTCMonth() + 1, day: moved.getUTCDate(), hour: 0 };
}

function weekdayOf(date: ClubDate): number {
  return new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
}

/** Axis label of one chart column: "14 h", "vie 25" or "2/9". */
export function formatPeriodLabel(startIso: string, span: PeriodSpan): string {
  const date = clubParts(startIso);
  if (span === "2h") return `${date.hour} h`;
  if (span === "1d") return `${WEEKDAYS_SHORT[weekdayOf(date)]} ${date.day}`;
  return `${date.day}/${date.month}`;
}

/** Sentence fragment naming the same column: "de 14 a 16 h", "viernes 25 de septiembre". */
export function formatPeriodDetail(startIso: string, span: PeriodSpan): string {
  const date = clubParts(startIso);
  if (span === "2h") return `de ${date.hour} a ${date.hour + 2} h`;
  if (span === "1d") return `${WEEKDAYS_LONG[weekdayOf(date)]} ${date.day} de ${MONTHS_LONG[date.month - 1]}`;
  const end = addDays(date, 5);
  return `del ${date.day} de ${MONTHS_LONG[date.month - 1]} al ${end.day} de ${MONTHS_LONG[end.month - 1]}`;
}

/** How long ago a sparkline point was read: "ahora", "hace 5 min", "hace 23 h", "hace 6 d 18 h". */
export function formatPointLabel(index: number, count: number, stepMinutes: number): string {
  const ago = (count - 1 - index) * stepMinutes;
  if (ago === 0) return "ahora";
  if (ago < 60) return `hace ${ago} min`;
  if (ago < 1440) return `hace ${Math.floor(ago / 60)} h`;
  const days = Math.floor(ago / 1440);
  const hours = Math.floor((ago % 1440) / 60);
  return hours === 0 ? `hace ${days} d` : `hace ${days} d ${hours} h`;
}

// --- Status copy -----------------------------------------------------------

const STATUS_COPY: Record<StatusKey, Record<HealthLevel, { sentence: string; action: string | null }>> = {
  app: {
    ok: { sentence: "La aplicación responde con normalidad.", action: null },
    warn: {
      sentence: "La aplicación responde con lentitud.",
      action: "Si las personas se quejan de demoras, avisa al equipo técnico.",
    },
    bad: {
      sentence: "La aplicación no está respondiendo.",
      action: "Avisa de inmediato al equipo técnico.",
    },
    unknown: { sentence: "Sin datos todavía sobre la aplicación.", action: null },
  },
  errors: {
    ok: { sentence: "No hay errores que afecten al club.", action: null },
    warn: {
      sentence: "Hay algunos errores que pueden afectar a ciertas personas.",
      action: "Revisa «Errores reportados» y avisa al equipo técnico si se repiten.",
    },
    bad: {
      sentence: "Hay errores frecuentes que afectan al club.",
      action: "Avisa de inmediato al equipo técnico.",
    },
    unknown: { sentence: "Sin datos todavía sobre los errores.", action: null },
  },
  notifications: {
    ok: { sentence: "Los correos y avisos están al día.", action: null },
    warn: {
      sentence: "Hay correos o avisos esperando para salir.",
      action: "Si siguen acumulándose, avisa al equipo técnico.",
    },
    bad: {
      sentence: "Los correos y avisos no están saliendo.",
      action: "Avisa de inmediato al equipo técnico.",
    },
    unknown: { sentence: "Sin datos todavía sobre los correos y avisos.", action: null },
  },
};

export function statusCopy(key: StatusKey, level: HealthLevel): { sentence: string; action: string | null } {
  return STATUS_COPY[key][level];
}

const HEALTH_COMPONENT_NAME: Record<HealthComponentKey, string> = {
  workers: "los procesos en segundo plano",
  email: "el envío de correos",
  outbox: "la cola de correos",
};

/** «a», «a y b», «a, b y c». */
function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} y ${names[names.length - 1]}`;
}

/**
 * The «Estado del sistema» row for a degraded heartbeat (ADMB-N1), or `null`
 * when `health` is missing, null or ok: a field the backend did not send must
 * never read as an alarm.
 */
export function healthCopy(health: SystemHealth | null | undefined): { sentence: string; action: string } | null {
  if (!health || !health.degraded || health.components.length === 0) return null;
  const names = joinNames(health.components.map(({ key }) => HEALTH_COMPONENT_NAME[key]));
  const silent = health.components.some(({ reason }) => reason !== "outbox_stale");
  return {
    sentence: `Hay una falla en ${names}.`,
    action: silent
      ? "Los avisos y correos pueden no estar saliendo. Avisa de inmediato al equipo técnico."
      : "Hay correos detenidos hace más de 30 minutos. Avisa al equipo técnico.",
  };
}
