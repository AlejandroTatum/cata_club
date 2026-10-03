/**
 * Métricas avanzadas — the technical follow-up, aggregates only.
 *
 * Organised the way an operator reads a system: the SERVICE as its users feel
 * it (RED: rate, errors, duration), the SERVER that carries it (USE:
 * utilisation, saturation, errors), what runs on it, and who is connected.
 * Never an address, a host name, a version or an e-mail: those would turn a
 * health screen into a surveillance one.
 */

import type { ReactElement, ReactNode } from "react";
import DashboardSection from "@/components/dashboard/DashboardSection";
import {
  Badge,
  InfoPanel,
  PAGE_RAIL,
  ScrollableTable,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@/components/ui";
import MetricBlock from "./MetricBlock";
import UsageBar from "./UsageBar";
import {
  CAPACITY_LIMITS,
  ENDPOINT_P95_LIMITS,
  ERROR_4XX_LIMITS,
  ERROR_5XX_LIMITS,
  LATENCY_P95_LIMITS,
  NOTIFICATION_AGE_LIMITS,
  formatAge,
  formatCount,
  formatDecimal,
  formatMegabytes,
  formatOrDash,
  formatUpdatedAgo,
  isStale,
  lastReading,
  minutesBetween,
  NO_READING,
  shareOf,
  shareOrNull,
  swapTone,
  toneForThresholds,
} from "./activity-utils";
import type {
  AvanzadasData,
  AvanzadasRange,
  HostMetrics,
  RuntimeMetrics,
  ServiceMetrics,
  UsersMetrics,
} from "./actividad-types";

const RANGE_PHRASE: Record<AvanzadasRange, string> = {
  "1h": "la última hora",
  "24h": "las últimas 24 horas",
  "7d": "los últimos 7 días",
};

const ROLE_ROWS = [
  { key: "estudiante", label: "Alumnos" },
  { key: "representante", label: "Representantes" },
  { key: "trainer", label: "Entrenadores" },
  { key: "admin", label: "Administradores" },
] as const;

/** "Actualizado hace N min", measured against the instant the figures were fetched. */
function Freshness({ at, now, warnWhenStale = false }: { at: string; now: string; warnWhenStale?: boolean }): ReactElement {
  return (
    <span className="flex flex-wrap items-center justify-end gap-2">
      {warnWhenStale && isStale(at, now) ? <Badge tone="warn">Datos desactualizados</Badge> : null}
      <span className="text-xs text-ink-3-strong">{formatUpdatedAgo(minutesBetween(at, now))}</span>
    </span>
  );
}

/** The block exists, but the collector has not written a reading for it yet. */
function NoMeasurements({ what }: { what: string }): ReactElement {
  return (
    <p className="m-0 px-[18px] py-4 text-sm text-ink-2">
      Aún no hay mediciones de {what}. Aparecerán cuando el sistema registre las primeras.
    </p>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }): ReactElement {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-field px-[18px] py-3">
      <dt className="text-sm text-ink-2">{label}</dt>
      <dd className="m-0 text-sm font-semibold tabular-nums text-ink">{children}</dd>
    </div>
  );
}

function Service({ service, now }: { service: ServiceMetrics | null; now: string }): ReactElement {
  if (!service) {
    return (
      <DashboardSection title="Servicio" testId="service-metrics">
        <NoMeasurements what="la aplicación" />
      </DashboardSection>
    );
  }
  const rate5xx = lastReading(service.errorRate5xx.values);
  const rate4xx = lastReading(service.errorRate4xx.values);
  const requests = lastReading(service.requestsPerMinute.values);
  const tone5xx = toneForThresholds(rate5xx, ERROR_5XX_LIMITS);
  const tone4xx = toneForThresholds(rate4xx, ERROR_4XX_LIMITS);
  const toneP95 = toneForThresholds(service.latencyMs.p95, LATENCY_P95_LIMITS);
  const percent = (value: number): string => formatDecimal(value, 1);

  return (
    <DashboardSection title="Servicio" testId="service-metrics" action={<Freshness at={service.updatedAt} now={now} />}>
      <div className="grid gap-section p-[18px] sm:grid-cols-3">
        <MetricBlock
          label="Solicitudes por minuto"
          value={formatOrDash(requests)}
          tone="ok"
          series={service.requestsPerMinute}
          formatValue={formatCount}
          caption="Tráfico de la aplicación"
        />
        <MetricBlock
          label="Errores del servidor"
          value={formatOrDash(rate5xx, percent)}
          unit={rate5xx === null ? undefined : "%"}
          tone={tone5xx}
          statusLabel={tone5xx === "bad" ? "Crítico" : "Atención"}
          series={service.errorRate5xx}
          formatValue={percent}
          threshold={ERROR_5XX_LIMITS.warn}
          caption="Fallas de la aplicación"
        />
        <MetricBlock
          label="Solicitudes rechazadas"
          value={formatOrDash(rate4xx, percent)}
          unit={rate4xx === null ? undefined : "%"}
          tone={tone4xx}
          statusLabel={tone4xx === "bad" ? "Crítico" : "Atención"}
          series={service.errorRate4xx}
          formatValue={percent}
          caption="Por ejemplo, una contraseña incorrecta"
        />
      </div>

      <dl className="m-0 grid grid-cols-3 gap-section border-t border-line px-[18px] py-4">
        {(["p50", "p95", "p99"] as const).map((key) => {
          const value = service.latencyMs[key];
          return (
            <div key={key} className="flex flex-col gap-field">
              <dt className="flex items-center gap-2 text-2xs font-bold uppercase text-ink-3-strong">
                <span>{key}</span>
                {key === "p95" && toneP95 !== "ok" ? <Badge tone={toneP95}>Atención</Badge> : null}
              </dt>
              <dd className="m-0 font-display text-xl leading-none tabular-nums tracking-flat text-ink">
                {formatOrDash(value)}
                {value === null ? null : (
                  <small className="ml-[3px] font-sans text-sm font-semibold text-ink-3-strong">ms</small>
                )}
              </dd>
            </div>
          );
        })}
      </dl>

      <div className="border-t border-line">
        {service.slowEndpoints.length === 0 ? (
          <NoMeasurements what="endpoints" />
        ) : (
          <ScrollableTable label="Endpoints más lentos, tabla desplazable">
            <Table aria-label="Endpoints más lentos">
              <TableHead>
                <TableRow>
                  <TableHeaderCell>Endpoint</TableHeaderCell>
                  <TableHeaderCell type="number">p95</TableHeaderCell>
                  <TableHeaderCell type="number">Solicitudes</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {service.slowEndpoints.map((endpoint) => {
                  const slow = toneForThresholds(endpoint.p95Ms, ENDPOINT_P95_LIMITS) !== "ok";
                  return (
                    <TableRow key={`${endpoint.method} ${endpoint.route}`}>
                      <TableCell className="whitespace-normal">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-field">
                          <span className="text-2xs font-bold text-ink-3-strong">{endpoint.method}</span>
                          <span className="break-all font-semibold text-ink">{endpoint.route}</span>
                          {slow ? <Badge tone="warn">Lento</Badge> : null}
                        </div>
                      </TableCell>
                      <TableCell type="number">
                        <span className="whitespace-nowrap">{formatCount(endpoint.p95Ms)} ms</span>
                      </TableCell>
                      <TableCell type="number">{formatCount(endpoint.requests)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </ScrollableTable>
        )}
      </div>
    </DashboardSection>
  );
}

function Server({ host, now }: { host: HostMetrics | null; now: string }): ReactElement {
  if (!host) {
    return (
      <DashboardSection title="Servidor" testId="server-metrics">
        <NoMeasurements what="el servidor" />
      </DashboardSection>
    );
  }
  const cpu = lastReading(host.cpuPercent.values);
  const ramPercent = shareOf(host.memory.usedMb, host.memory.totalMb);
  const disk = lastReading(host.diskPercent.values);
  const cpuTone = toneForThresholds(cpu, CAPACITY_LIMITS);
  const ramTone = toneForThresholds(ramPercent, CAPACITY_LIMITS);
  const diskTone = toneForThresholds(disk, CAPACITY_LIMITS);
  const swapGrowing = swapTone(host.swap.series.values) === "warn";
  const ramSeries = {
    stepMinutes: host.memory.series.stepMinutes,
    values: host.memory.series.values.map((used) => (used === null ? null : shareOf(used, host.memory.totalMb))),
  };

  return (
    <DashboardSection
      title="Servidor"
      testId="server-metrics"
      action={<Freshness at={host.updatedAt} now={now} warnWhenStale />}
    >
      <div className="grid gap-section p-[18px] sm:grid-cols-2">
        <MetricBlock
          label="Procesador"
          value={formatOrDash(cpu)}
          unit={cpu === null ? undefined : "%"}
          tone={cpuTone}
          statusLabel="Atención"
          series={host.cpuPercent}
          formatValue={formatCount}
          threshold={CAPACITY_LIMITS.warn}
          caption="Uso del procesador del servidor"
          testId="metric-cpu"
        />
        <MetricBlock
          label="Memoria RAM"
          value={formatCount(ramPercent)}
          unit="%"
          tone={ramTone}
          statusLabel="Atención"
          series={ramSeries}
          formatValue={formatCount}
          threshold={CAPACITY_LIMITS.warn}
          caption={`${formatMegabytes(host.memory.usedMb)} de ${formatMegabytes(host.memory.totalMb)}`}
          testId="metric-ram"
        />
        <MetricBlock
          label="Memoria de respaldo (swap)"
          value={formatMegabytes(host.swap.usedMb)}
          tone={swapGrowing ? "warn" : "ok"}
          statusLabel="En aumento"
          series={host.swap.series}
          formatValue={formatCount}
          caption={`de ${formatMegabytes(host.swap.totalMb)}${swapGrowing ? " · sigue creciendo" : ""}`}
          testId="metric-swap"
        />
        <MetricBlock
          label="Disco"
          value={formatOrDash(disk)}
          unit={disk === null ? undefined : "%"}
          tone={diskTone}
          statusLabel="Atención"
          series={host.diskPercent}
          formatValue={formatCount}
          threshold={CAPACITY_LIMITS.warn}
          caption="Espacio ocupado"
          testId="metric-disk"
        />
      </div>
    </DashboardSection>
  );
}

function Containers({ runtime, now }: { runtime: RuntimeMetrics | null; now: string }): ReactElement {
  if (!runtime) {
    return (
      <DashboardSection title="Memoria por contenedor" testId="container-memory">
        <NoMeasurements what="los contenedores" />
      </DashboardSection>
    );
  }
  return (
    <DashboardSection
      title="Memoria por contenedor"
      testId="container-memory"
      action={<Freshness at={runtime.updatedAt} now={now} />}
    >
      {runtime.containers.length === 0 ? (
        <NoMeasurements what="los contenedores" />
      ) : (
        <ul className="m-0 grid list-none gap-x-page gap-y-4 p-[18px] sm:grid-cols-2">
          {runtime.containers.map((container) => {
            const percent = shareOf(container.usedMb, container.limitMb);
            const tone = toneForThresholds(percent, { warn: 85, bad: 95 });
            const figures = `${formatMegabytes(container.usedMb)} de ${formatMegabytes(container.limitMb)}`;
            return (
              <li key={container.name} className="flex min-w-0 flex-col gap-field">
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="min-w-0 truncate font-semibold text-ink">{container.name}</span>
                  <span className="flex-none tabular-nums text-ink-2">{figures}</span>
                </div>
                <UsageBar
                  label={`${container.name}: ${figures} (${percent}%)`}
                  used={container.usedMb}
                  limit={container.limitMb}
                  tone={tone}
                />
              </li>
            );
          })}
        </ul>
      )}
    </DashboardSection>
  );
}

function Users({ users, range, now }: { users: UsersMetrics | null; range: AvanzadasRange; now: string }): ReactElement {
  if (!users) {
    return (
      <DashboardSection title="Usuarios" testId="users-metrics">
        <NoMeasurements what="usuarios" />
      </DashboardSection>
    );
  }
  const attempts = users.loginsOk + users.loginsFailed;
  const failedShare = shareOf(users.loginsFailed, attempts);
  const failedTone = toneForThresholds(failedShare, { warn: 15, bad: 30 });
  const { sessionsByRole } = users;
  return (
    <DashboardSection title="Usuarios" testId="users-metrics" action={<Freshness at={users.updatedAt} now={now} />}>
      <div className="flex flex-col gap-field px-[18px] py-4">
        <span className="font-display text-2xl leading-none tabular-nums tracking-flat text-ink">
          {formatOrDash(users.connectedNow)}
        </span>
        <span className="text-xs text-ink-3-strong">Conectados ahora (últimos 5 min)</span>
      </div>
      <dl className="m-0 divide-y divide-line border-t border-line">
        <Row label={`Ingresos correctos, ${RANGE_PHRASE[range]}`}>{formatCount(users.loginsOk)}</Row>
        <Row label={`Ingresos fallidos, ${RANGE_PHRASE[range]}`}>
          {failedTone !== "ok" ? <Badge tone={failedTone} className="mr-2">Atención</Badge> : null}
          {formatCount(users.loginsFailed)}
        </Row>
      </dl>
      <div className="border-t border-line">
        <h3 className="m-0 px-[18px] pt-4 text-2xs font-bold uppercase text-ink-3-strong">Sesiones activas por rol</h3>
        {sessionsByRole ? (
          <dl className="m-0 divide-y divide-line">
            {ROLE_ROWS.map(({ key, label }) => (
              <Row key={key} label={label}>
                {formatCount(sessionsByRole[key])}
              </Row>
            ))}
          </dl>
        ) : (
          <NoMeasurements what="sesiones" />
        )}
      </div>
    </DashboardSection>
  );
}

/** One "used of limit" line with its bar; the bar needs both figures, the line says what it has. */
function Capacity({
  label,
  barLabel,
  used,
  limit,
  format,
  tone,
}: {
  label: string;
  barLabel: string;
  used: number | null;
  limit: number | null;
  format: (value: number) => string;
  tone: "ok" | "warn" | "bad";
}): ReactElement {
  const figures =
    used === null ? NO_READING : limit === null ? format(used) : `${format(used)} de ${format(limit)}`;
  const percent = shareOrNull(used, limit);
  return (
    <div className="flex flex-col gap-field">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="text-ink-2">{label}</span>
        <span className="font-semibold tabular-nums text-ink">{figures}</span>
      </div>
      {used !== null && limit !== null && percent !== null ? (
        <UsageBar label={`${barLabel}: ${figures} (${percent}%)`} used={used} limit={limit} tone={tone} />
      ) : null}
    </div>
  );
}

function Backstage({ runtime, now }: { runtime: RuntimeMetrics | null; now: string }): ReactElement {
  if (!runtime) {
    return (
      <DashboardSection title="Base de datos, caché y colas" testId="backstage-metrics">
        <NoMeasurements what="la base de datos, la caché y las colas" />
      </DashboardSection>
    );
  }
  const { database, redis, queues } = runtime;
  const connectionsPercent = shareOrNull(database.connectionsUsed, database.connectionsMax);
  const redisPercent = shareOrNull(redis.usedMb, redis.maxMb);
  const ageTone = toneForThresholds(queues.oldestNotificationMinutes, NOTIFICATION_AGE_LIMITS);

  return (
    <DashboardSection
      title="Base de datos, caché y colas"
      testId="backstage-metrics"
      action={<Freshness at={runtime.updatedAt} now={now} />}
    >
      <div className="flex flex-col gap-4 px-[18px] py-4">
        <Capacity
          label="Conexiones a la base de datos"
          barLabel="Conexiones a la base de datos"
          used={database.connectionsUsed}
          limit={database.connectionsMax}
          format={formatCount}
          tone={toneForThresholds(connectionsPercent, CAPACITY_LIMITS)}
        />
        <Capacity
          label="Memoria de la caché (Redis)"
          barLabel="Memoria de la caché"
          used={redis.usedMb}
          limit={redis.maxMb}
          format={formatMegabytes}
          tone={toneForThresholds(redisPercent, CAPACITY_LIMITS)}
        />
      </div>
      <dl className="m-0 divide-y divide-line border-t border-line">
        <Row label="Tareas pendientes (Celery)">{formatOrDash(queues.celeryPending)}</Row>
        <Row label="Notificaciones pendientes">{formatOrDash(queues.notificationsPending)}</Row>
        <Row label="La más antigua espera">
          {ageTone !== "ok" ? <Badge tone={ageTone} className="mr-2">Atención</Badge> : null}
          {formatOrDash(queues.oldestNotificationMinutes, formatAge)}
        </Row>
      </dl>
    </DashboardSection>
  );
}

/** `now` is the instant the figures were fetched, so every "hace N min" is measured against one clock. */
export default function AvanzadasView({ data, now }: { data: AvanzadasData; now: string }): ReactElement {
  return (
    <div data-testid="advanced-work" className={PAGE_RAIL}>
      <div className="flex min-w-0 flex-col gap-page">
        <Service service={data.service} now={now} />
        <Server host={data.host} now={now} />
        <Containers runtime={data.runtime} now={now} />
      </div>
      <div className="flex min-w-0 flex-col gap-page">
        <Users users={data.users} range={data.range} now={now} />
        <Backstage runtime={data.runtime} now={now} />
        <InfoPanel title="Cómo leer estas métricas">
          <p>Son cifras agregadas: no identifican a ninguna persona ni a ningún equipo.</p>
          <dl className="m-0 grid gap-1.5 border-t border-line pt-3">
            <dt className="font-semibold text-ink">Tiempos de respuesta</dt>
            <dd className="m-0">
              <b className="font-semibold text-ink">p50</b>: lo que tarda una solicitud típica.
            </dd>
            <dd className="m-0">
              <b className="font-semibold text-ink">p95 y p99</b>: lo que tardan las más lentas; si suben, algunas
              personas ya lo notan.
            </dd>
            <dt className="mt-2 font-semibold text-ink">Errores</dt>
            <dd className="m-0">
              <b className="font-semibold text-ink">Del servidor</b>: fallas de la aplicación.{" "}
              <b className="font-semibold text-ink">Rechazadas</b>: solicitudes que no se aceptaron, por ejemplo una
              contraseña incorrecta.
            </dd>
          </dl>
        </InfoPanel>
      </div>
    </div>
  );
}
