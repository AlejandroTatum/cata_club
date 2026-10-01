import { CLUB_TIME_ZONE } from "@/lib/club-date";
import type { ReporteError } from "@/services/api";

const DATE_FORMAT = new Intl.DateTimeFormat("es-EC", { dateStyle: "medium", timeStyle: "short", timeZone: CLUB_TIME_ZONE });
const DAY_MS = 24 * 60 * 60 * 1000;
/** Route chips offered next to "Todos" and "Últimos 7 días". */
const MAX_ROUTE_CHIPS = 3;

export const NO_DISPONIBLE = "No disponible";

/** Timestamps without an offset are UTC on the backend; parse them as such. */
function parseFecha(iso: string): Date {
  return new Date(/(?:Z|[+-]\d{2}:?\d{2})$/.test(iso) ? iso : `${iso}Z`);
}

export function formatFecha(iso: string): string {
  return DATE_FORMAT.format(parseFecha(iso));
}

/** "Chrome · Windows" style summary; falls back to null when unrecognised. */
export function resumirNavegador(userAgent: string | null): string | null {
  if (!userAgent) return null;
  const navegador = /Edg\//.test(userAgent) ? "Edge"
    : /OPR\//.test(userAgent) ? "Opera"
    : /Firefox\//.test(userAgent) ? "Firefox"
    : /Chrome\/|CriOS\//.test(userAgent) ? "Chrome"
    : /Safari\//.test(userAgent) ? "Safari" : null;
  const sistema = /Android/.test(userAgent) ? "Android"
    : /iPhone|iPad|iOS/.test(userAgent) ? "iOS"
    : /Windows/.test(userAgent) ? "Windows"
    : /Mac OS X|Macintosh/.test(userAgent) ? "macOS"
    : /Linux|X11/.test(userAgent) ? "Linux" : null;
  const partes = [navegador, sistema].filter((p): p is string => p !== null);
  return partes.length > 0 ? partes.join(" · ") : null;
}

interface Top { value: string; count: number }

/** Most frequent value; ties resolve to the one seen first. */
function mostFrequent(values: readonly (string | null)[]): Top | null {
  const counts = new Map<string, number>();
  for (const value of values) if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
  let best: Top | null = null;
  for (const [value, count] of counts) if (!best || count > best.count) best = { value, count };
  return best;
}

export interface InboxSummary {
  total: number;
  lastWeek: number;
  topRoute: Top | null;
  topDevice: Top | null;
}

export function isLastWeek(report: ReporteError, now: number): boolean {
  return now - parseFecha(report.fecha_creacion).getTime() <= 7 * DAY_MS;
}

export function summarize(reports: readonly ReporteError[], now: number): InboxSummary {
  return {
    total: reports.length,
    lastWeek: reports.filter((r) => isLastWeek(r, now)).length,
    topRoute: mostFrequent(reports.map((r) => r.ruta)),
    topDevice: mostFrequent(reports.map((r) => resumirNavegador(r.user_agent))),
  };
}

export type InboxFilter = "todos" | "7d" | `ruta:${string}`;

export interface FilterChip { key: InboxFilter; label: string; count: number }

export function buildChips(reports: readonly ReporteError[], now: number): FilterChip[] {
  const routes = new Map<string, number>();
  for (const { ruta } of reports) if (ruta) routes.set(ruta, (routes.get(ruta) ?? 0) + 1);
  const byRoute = [...routes].sort((a, b) => b[1] - a[1]).slice(0, MAX_ROUTE_CHIPS)
    .map(([ruta, count]): FilterChip => ({ key: `ruta:${ruta}`, label: ruta, count }));
  return [
    { key: "todos", label: "Todos", count: reports.length },
    { key: "7d", label: "Últimos 7 días", count: reports.filter((r) => isLastWeek(r, now)).length },
    ...byRoute,
  ];
}

export function applyFilter(reports: readonly ReporteError[], filter: InboxFilter, now: number): ReporteError[] {
  if (filter === "todos") return [...reports];
  if (filter === "7d") return reports.filter((r) => isLastWeek(r, now));
  return reports.filter((r) => r.ruta === filter.slice("ruta:".length));
}
