/**
 * The public launch of the club's system, 17:00 in Ecuador (UTC-5, no DST).
 * Single source of truth for the landing's launch curtain.
 */
export const LAUNCH_AT_ISO = "2026-10-05T17:00:00-05:00";

export const LAUNCH_AT = Date.parse(LAUNCH_AT_ISO);

/** The countdown only appears this long before the launch (16:30); earlier the curtain just says it is coming. */
export const COUNTDOWN_LEAD_MS = 30 * 60_000;
export const COUNTDOWN_FROM = LAUNCH_AT - COUNTDOWN_LEAD_MS;

/** True once the remaining time is short enough to show the numbers. */
export function isCountdownVisible(remainingMs: number): boolean {
  return remainingMs <= COUNTDOWN_LEAD_MS;
}

/**
 * The launch instant in epoch ms. The server-only `LAUNCH_AT_OVERRIDE` (any
 * ISO date) replaces it at runtime so the curtain can be exercised, and the
 * e2e suite can run the landing, without waiting for 17:00. Call it from the
 * server and pass the result down: it is never inlined into the client bundle.
 */
export function resolveLaunchAt(override: string | undefined = process.env.LAUNCH_AT_OVERRIDE): number {
  const parsed = override ? Date.parse(override) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : LAUNCH_AT;
}

export interface CountdownParts {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
}

/** Splits the remaining milliseconds into whole units; never negative. */
export function countdownParts(remainingMs: number): CountdownParts {
  const total = Math.max(0, Math.ceil(remainingMs / 1000));
  return {
    days: Math.floor(total / 86_400),
    hours: Math.floor((total % 86_400) / 3_600),
    minutes: Math.floor((total % 3_600) / 60),
    seconds: total % 60,
  };
}

/** Two digits minimum, so the numerals keep a stable width. */
export function padUnit(value: number): string {
  return String(value).padStart(2, "0");
}

function plural(value: number, one: string, many: string): string {
  return `${value} ${value === 1 ? one : many}`;
}

/** Spoken form for the polite live region, e.g. "2 horas, 5 minutos". */
export function countdownSpeech({ days, hours, minutes, seconds }: CountdownParts): string {
  const spoken: string[] = [];
  if (days) spoken.push(plural(days, "día", "días"));
  if (days || hours) spoken.push(plural(hours, "hora", "horas"));
  spoken.push(plural(minutes, "minuto", "minutos"));
  if (!days && !hours && !minutes) spoken.push(plural(seconds, "segundo", "segundos"));
  return spoken.join(", ");
}
