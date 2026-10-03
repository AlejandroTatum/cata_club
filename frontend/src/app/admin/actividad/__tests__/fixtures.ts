/**
 * Deterministic fixtures for the "Actividad del club" tests — not production
 * data, and not imported by any production module. They are shaped exactly like
 * the backend's `ResumenResponse` / `AvanzadasResponse`.
 *
 * No `Math.random`, no `Date.now`: the "current" instant is the fixed
 * `FIXTURE_NOW`, so a render and a test see the same screen.
 */

import type {
  AvanzadasData,
  AvanzadasRange,
  ResumenData,
  ResumenPeriod,
  ResumenRange,
  RoleCounts,
  Series,
  SlowEndpoint,
} from "../actividad-types";

/** The instant every "hace N min" is measured against (America/Guayaquil, UTC-5). */
export const FIXTURE_NOW = "2026-10-01T15:30:00-05:00";

/** The system status is a "now" reading, so every range shares it. */
const STATUS: ResumenData["status"] = [
  { key: "app", level: "ok" },
  { key: "errors", level: "ok" },
  { key: "notifications", level: "warn" },
];

const roles = (alumnos: number, entrenadores: number, representantes: number): RoleCounts => ({
  alumnos,
  entrenadores,
  representantes,
});

function periods(
  starts: readonly string[],
  visitors: readonly RoleCounts[],
  attendances: readonly number[],
  payments: readonly number[],
  enrollments: readonly number[],
): ResumenPeriod[] {
  return starts.map((start, i) => ({
    start,
    visitors: visitors[i],
    attendances: attendances[i],
    payments: payments[i],
    enrollments: enrollments[i],
  }));
}

const RESUMEN: Record<ResumenRange, ResumenData> = {
  "24h": {
    range: "24h",
    generatedAt: FIXTURE_NOW,
    span: "2h",
    periods: periods(
      [
        "2026-09-30T16:00:00-05:00", "2026-09-30T18:00:00-05:00", "2026-09-30T20:00:00-05:00",
        "2026-09-30T22:00:00-05:00", "2026-10-01T00:00:00-05:00", "2026-10-01T02:00:00-05:00",
        "2026-10-01T04:00:00-05:00", "2026-10-01T06:00:00-05:00", "2026-10-01T08:00:00-05:00",
        "2026-10-01T10:00:00-05:00", "2026-10-01T12:00:00-05:00", "2026-10-01T14:00:00-05:00",
      ],
      [
        roles(18, 3, 9), roles(26, 5, 14), roles(14, 2, 11), roles(5, 0, 6), roles(1, 0, 2), roles(0, 0, 0),
        roles(1, 0, 1), roles(4, 1, 3), roles(9, 2, 8), roles(12, 3, 10), roles(16, 3, 9), roles(15, 2, 7),
      ],
      [12, 18, 0, 0, 0, 0, 0, 0, 0, 0, 6, 9],
      [2, 3, 1, 0, 0, 0, 0, 0, 1, 3, 4, 2],
      [0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0],
    ),
    uniqueVisitors: { alumnos: 74, entrenadores: 7, representantes: 52, total: 129 },
    status: STATUS,
    queuedByQuota: 0,
  },
  "7d": {
    range: "7d",
    generatedAt: FIXTURE_NOW,
    span: "1d",
    periods: periods(
      [
        "2026-09-25T00:00:00-05:00", "2026-09-26T00:00:00-05:00", "2026-09-27T00:00:00-05:00",
        "2026-09-28T00:00:00-05:00", "2026-09-29T00:00:00-05:00", "2026-09-30T00:00:00-05:00",
        "2026-10-01T00:00:00-05:00",
      ],
      [
        roles(58, 9, 34), roles(61, 10, 38), roles(22, 6, 19), roles(70, 11, 41),
        roles(66, 10, 40), roles(64, 9, 36), roles(74, 8, 43),
      ],
      [96, 104, 0, 118, 112, 109, 41],
      [7, 9, 4, 11, 13, 10, 6],
      [1, 2, 0, 3, 2, 4, 1],
    ),
    uniqueVisitors: { alumnos: 132, entrenadores: 9, representantes: 87, total: 222 },
    status: STATUS,
    queuedByQuota: 0,
  },
  "30d": {
    range: "30d",
    generatedAt: FIXTURE_NOW,
    span: "6d",
    periods: periods(
      [
        "2026-09-02T00:00:00-05:00", "2026-09-08T00:00:00-05:00", "2026-09-14T00:00:00-05:00",
        "2026-09-20T00:00:00-05:00", "2026-09-26T00:00:00-05:00",
      ],
      [roles(310, 42, 180), roles(352, 48, 205), roles(368, 51, 214), roles(341, 47, 198), roles(396, 52, 230)],
      [640, 702, 718, 690, 744],
      [48, 61, 57, 52, 66],
      [4, 7, 5, 6, 9],
    ),
    uniqueVisitors: { alumnos: 171, entrenadores: 11, representantes: 118, total: 291 },
    status: STATUS,
    queuedByQuota: 0,
  },
};

/** Backend-shaped summary for `range`. */
export function resumenFixture(range: ResumenRange): ResumenData {
  return RESUMEN[range];
}

/**
 * A smooth, repeatable curve: `base` ± `amplitude`, `cycles` full waves over
 * `count` points. Integer-rounded unless `digits` asks for decimals.
 */
function wave(count: number, base: number, amplitude: number, cycles: number, phase = 0, digits = 0): number[] {
  const scale = 10 ** digits;
  return Array.from({ length: count }, (_, i) => {
    const angle = (i / Math.max(count - 1, 1)) * cycles * 2 * Math.PI + phase;
    const value = base + amplitude * (Math.sin(angle) * 0.7 + Math.sin(angle * 2.3 + 1) * 0.3);
    return Math.max(0, Math.round(value * scale) / scale);
  });
}

/** `from` → `to` in a straight climb with a little deterministic texture. */
function ramp(count: number, from: number, to: number, texture = 0): number[] {
  return Array.from({ length: count }, (_, i) => {
    const t = i / Math.max(count - 1, 1);
    const bump = texture * Math.sin(i * 1.9) * (1 - t * 0.5);
    return Math.round(from + (to - from) * t + bump);
  });
}

/** Same series with its last value pinned, so the headline figure matches the text. */
const endingAt = (values: number[], last: number): number[] => [...values.slice(0, -1), last];

const SHAPES: Record<AvanzadasRange, { points: number; stepMinutes: number }> = {
  "1h": { points: 60, stepMinutes: 1 },
  "24h": { points: 24, stepMinutes: 60 },
  "7d": { points: 28, stepMinutes: 360 },
};

const SLOW_ENDPOINTS: readonly Omit<SlowEndpoint, "requests">[] = [
  { method: "GET", route: "/api/v1/asistencias/reportes", p95Ms: 1180 },
  { method: "GET", route: "/api/v1/membresias/pagos", p95Ms: 640 },
  { method: "GET", route: "/api/v1/personas/{persona_id}", p95Ms: 410 },
  { method: "POST", route: "/api/v1/auth/login", p95Ms: 380 },
  { method: "GET", route: "/api/v1/dashboard/stats", p95Ms: 350 },
];

/** Requests per endpoint over the whole range. */
const ENDPOINT_REQUESTS: Record<AvanzadasRange, readonly number[]> = {
  "1h": [14, 52, 188, 41, 96],
  "24h": [212, 905, 3320, 604, 1810],
  "7d": [1480, 6120, 21900, 4210, 12600],
};

function buildAvanzadas(range: AvanzadasRange): AvanzadasData {
  const { points, stepMinutes } = SHAPES[range];
  const series = (values: readonly number[]): Series => ({ stepMinutes, values });
  const requestScale = range === "1h" ? 1 : range === "24h" ? 0.8 : 0.7;

  return {
    range,
    service: {
      updatedAt: "2026-10-01T15:29:00-05:00",
      requestsPerMinute: series(wave(points, 38 * requestScale, 16, range === "1h" ? 2 : 2.5, 0.4)),
      errorRate5xx: series(endingAt(wave(points, 0.3, 0.25, 3, 1.2, 2), 0.2)),
      errorRate4xx: series(endingAt(wave(points, 2.1, 0.9, 2, 0.2, 1), 2.4)),
      latencyMs: { p50: 42, p95: 310, p99: 640 },
      slowEndpoints: SLOW_ENDPOINTS.map((endpoint, i) => ({ ...endpoint, requests: ENDPOINT_REQUESTS[range][i] })),
    },
    host: {
      updatedAt: "2026-10-01T15:28:00-05:00",
      cpuPercent: series(endingAt(wave(points, 31, 12, 2.5, 0.9), 31)),
      memory: {
        usedMb: 2350,
        totalMb: 3900,
        series: series(endingAt(wave(points, 2300, 90, 1.5, 0.3), 2350)),
      },
      // The demo's warning: swap keeps growing across the window.
      swap: {
        usedMb: range === "7d" ? 310 : 214,
        totalMb: 1024,
        series: series(
          range === "7d" ? ramp(points, 120, 310, 4) : range === "24h" ? ramp(points, 150, 214, 2) : ramp(points, 190, 214, 1),
        ),
      },
      diskPercent: series(ramp(points, range === "7d" ? 51 : 53, 54)),
    },
    runtime: {
      updatedAt: "2026-10-01T15:28:00-05:00",
      containers: [
        { name: "backend", usedMb: 262, limitMb: 320 },
        { name: "db", usedMb: 214, limitMb: 320 },
        { name: "celery-worker", usedMb: 196, limitMb: 320 },
        { name: "celery-beat", usedMb: 118, limitMb: 224 },
        { name: "frontend", usedMb: 171, limitMb: 256 },
        { name: "caddy", usedMb: 38, limitMb: 96 },
        { name: "redis", usedMb: 22, limitMb: 64 },
        { name: "autoheal", usedMb: 9, limitMb: 32 },
      ],
      database: { connectionsUsed: 14, connectionsMax: 100 },
      redis: { usedMb: 22, maxMb: 48 },
      queues: { celeryPending: 3, notificationsPending: 12, oldestNotificationMinutes: 47 },
    },
    users: {
      updatedAt: "2026-10-01T15:29:00-05:00",
      connectedNow: 9,
      loginsOk: range === "1h" ? 11 : range === "24h" ? 129 : 801,
      loginsFailed: range === "1h" ? 1 : range === "24h" ? 9 : 52,
      sessionsByRole: { estudiante: 14, representante: 9, trainer: 3, admin: 1 },
    },
  };
}

const AVANZADAS: Record<AvanzadasRange, AvanzadasData> = {
  "1h": buildAvanzadas("1h"),
  "24h": buildAvanzadas("24h"),
  "7d": buildAvanzadas("7d"),
};

/** Backend-shaped advanced metrics for `range`. */
export function avanzadasFixture(range: AvanzadasRange): AvanzadasData {
  return AVANZADAS[range];
}
