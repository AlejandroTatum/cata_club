/**
 * Wire types of "Actividad del club" — one-to-one with the backend schemas in
 * `backend/app/servicios_negocio/dtos/actividad_schemas.py` (`ResumenResponse`,
 * `AvanzadasResponse`). Raw counts, ISO instants in the club's offset and
 * series with a step: the components format, the endpoint never sends copy.
 *
 * Wherever a real reading may not exist the type says so (`null`, `"unknown"`)
 * instead of inventing a zero.
 */

export type ResumenRange = "24h" | "7d" | "30d";
export type AvanzadasRange = "1h" | "24h" | "7d";

export const RESUMEN_RANGE_VALUES: readonly ResumenRange[] = ["24h", "7d", "30d"];
export const AVANZADAS_RANGE_VALUES: readonly AvanzadasRange[] = ["1h", "24h", "7d"];

/** Width of one column of the usage chart. */
export type PeriodSpan = "2h" | "1d" | "6d";

/** `unknown` = no snapshot has been taken yet. */
export type HealthLevel = "ok" | "warn" | "bad" | "unknown";

/** The levels a reading can be drawn with (pills, bars, lines). */
export type Tone = Exclude<HealthLevel, "unknown">;

export interface RoleCounts {
  alumnos: number;
  entrenadores: number;
  representantes: number;
}

export interface ResumenPeriod {
  /** ISO start of the period, in the club's offset. */
  start: string;
  visitors: RoleCounts;
  attendances: number;
  payments: number;
  enrollments: number;
}

export type StatusKey = "app" | "errors" | "notifications";

/** Parts of the system the worker heartbeat can report as degraded (backend `ComponenteDegradado`). */
export type HealthComponentKey = "workers" | "email" | "outbox";
export type HealthReason = "heartbeat_missing" | "heartbeat_stale" | "outbox_stale";

/**
 * The heartbeat cross-check of both endpoints (backend `SaludSistema`, ADMB-N1).
 * Optional on purpose: an older backend, or a heartbeat that could not be read,
 * sends no `health` and the screen must carry on without it.
 */
export interface SystemHealth {
  state: "ok" | "degraded";
  degraded: boolean;
  heartbeatAgeSeconds: number | null;
  components: readonly { key: HealthComponentKey; reason: HealthReason }[];
}

export interface ResumenData {
  range: ResumenRange;
  generatedAt: string;
  span: PeriodSpan;
  periods: readonly ResumenPeriod[];
  /** Distinct people over the whole range (not the sum of the periods). */
  uniqueVisitors: RoleCounts & { total: number };
  status: readonly { key: StatusKey; level: HealthLevel }[];
  /** Emails waiting for the daily sending limit to reset (retried next day). */
  queuedByQuota: number;
  health?: SystemHealth | null;
}

export interface Series {
  /** Minutes between two consecutive values. */
  stepMinutes: number;
  /** Oldest first; the last value is "now". `null` = no reading that minute/hour. */
  values: readonly (number | null)[];
}

export interface SlowEndpoint {
  /** Any HTTP verb. */
  method: string;
  /** Route template, never a concrete URL. */
  route: string;
  p95Ms: number;
  requests: number;
}

export interface ContainerMemory {
  name: string;
  usedMb: number;
  limitMb: number;
}

export interface MemoryWithSeries {
  usedMb: number;
  totalMb: number;
  series: Series;
}

export interface ServiceMetrics {
  updatedAt: string;
  requestsPerMinute: Series;
  errorRate5xx: Series;
  errorRate4xx: Series;
  latencyMs: { p50: number | null; p95: number | null; p99: number | null };
  slowEndpoints: readonly SlowEndpoint[];
}

export interface HostMetrics {
  updatedAt: string;
  cpuPercent: Series;
  memory: MemoryWithSeries;
  swap: MemoryWithSeries;
  diskPercent: Series;
}

export interface RuntimeMetrics {
  updatedAt: string;
  containers: readonly ContainerMemory[];
  database: { connectionsUsed: number | null; connectionsMax: number | null };
  redis: { usedMb: number | null; maxMb: number | null };
  queues: {
    celeryPending: number | null;
    notificationsPending: number | null;
    oldestNotificationMinutes: number | null;
  };
}

export interface SessionsByRole {
  admin: number;
  trainer: number;
  estudiante: number;
  representante: number;
}

export interface UsersMetrics {
  updatedAt: string;
  connectedNow: number | null;
  loginsOk: number;
  loginsFailed: number;
  sessionsByRole: SessionsByRole | null;
}

export interface AvanzadasData {
  range: AvanzadasRange;
  service: ServiceMetrics | null;
  host: HostMetrics | null;
  runtime: RuntimeMetrics | null;
  users: UsersMetrics | null;
  health?: SystemHealth | null;
}
