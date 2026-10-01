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
  formatUpdatedAgo,
  minutesBetween,
  shareOf,
  swapTone,
  toneForThresholds,
} from "./activity-utils";
import { DEMO_NOW, type AvanzadasData, type AvanzadasRange } from "./demo-data";

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

const last = (values: readonly number[]): number => values[values.length - 1];

/** "Actualizado hace N min", measured against the snapshot's own clock. */
function Freshness({ at }: { at: string }): ReactElement {
  return <span className="text-xs text-ink-3-strong">{formatUpdatedAgo(minutesBetween(at, DEMO_NOW))}</span>;
}

function Row({ label, children }: { label: string; children: ReactNode }): ReactElement {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-field px-[18px] py-3">
      <dt className="text-sm text-ink-2">{label}</dt>
      <dd className="m-0 text-sm font-semibold tabular-nums text-ink">{children}</dd>
    </div>
  );
}

function Service({ data }: { data: AvanzadasData }): ReactElement {
  const { service } = data;
  const rate5xx = last(service.errorRate5xx.values);
  const rate4xx = last(service.errorRate4xx.values);
  const tone5xx = toneForThresholds(rate5xx, ERROR_5XX_LIMITS);
  const tone4xx = toneForThresholds(rate4xx, ERROR_4XX_LIMITS);
  const toneP95 = toneForThresholds(service.latencyMs.p95, LATENCY_P95_LIMITS);
  const percent = (value: number): string => formatDecimal(value, 1);

  return (
    <DashboardSection title="Servicio" testId="service-metrics" action={<Freshness at={service.updatedAt} />}>
      <div className="grid gap-section p-[18px] sm:grid-cols-3">
        <MetricBlock
          label="Solicitudes por minuto"
          value={formatCount(last(service.requestsPerMinute.values))}
          tone="ok"
          series={service.requestsPerMinute}
          formatValue={formatCount}
        />
        <MetricBlock
          label="Errores 5xx"
          value={percent(rate5xx)}
          unit="%"
          tone={tone5xx}
          statusLabel={tone5xx === "bad" ? "Crítico" : "Atención"}
          series={service.errorRate5xx}
          formatValue={percent}
          threshold={ERROR_5XX_LIMITS.warn}
          caption="Fallas del servidor"
        />
        <MetricBlock
          label="Errores 4xx"
          value={percent(rate4xx)}
          unit="%"
          tone={tone4xx}
          statusLabel={tone4xx === "bad" ? "Crítico" : "Atención"}
          series={service.errorRate4xx}
          formatValue={percent}
          caption="Solicitudes rechazadas"
        />
      </div>

      <dl className="m-0 grid grid-cols-3 gap-section border-t border-line px-[18px] py-4">
        {(["p50", "p95", "p99"] as const).map((key) => (
          <div key={key} className="flex flex-col gap-field">
            <dt className="flex items-center gap-2 text-2xs font-bold uppercase text-ink-3-strong">
              <span>{key}</span>
              {key === "p95" && toneP95 !== "ok" ? <Badge tone={toneP95}>Atención</Badge> : null}
            </dt>
            <dd className="m-0 font-display text-xl leading-none tabular-nums tracking-flat text-ink">
              {formatCount(service.latencyMs[key])}
              <small className="ml-[3px] font-sans text-sm font-semibold text-ink-3-strong">ms</small>
            </dd>
          </div>
        ))}
      </dl>

      <div className="border-t border-line">
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
                    <TableCell>
                      <span className="mr-2 text-2xs font-bold text-ink-3-strong">{endpoint.method}</span>
                      <span className="font-semibold text-ink">{endpoint.route}</span>
                    </TableCell>
                    <TableCell type="number">
                      {slow ? <Badge tone="warn" className="mr-2">Lento</Badge> : null}
                      {formatCount(endpoint.p95Ms)} ms
                    </TableCell>
                    <TableCell type="number">{formatCount(endpoint.requests)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </ScrollableTable>
      </div>
    </DashboardSection>
  );
}

function Server({ data }: { data: AvanzadasData }): ReactElement {
  const { host } = data;
  const cpu = last(host.cpuPercent.values);
  const ramPercent = shareOf(host.memory.usedMb, host.memory.totalMb);
  const disk = last(host.diskPercent.values);
  const cpuTone = toneForThresholds(cpu, CAPACITY_LIMITS);
  const ramTone = toneForThresholds(ramPercent, CAPACITY_LIMITS);
  const diskTone = toneForThresholds(disk, CAPACITY_LIMITS);
  const swapGrowing = swapTone(host.swap.series.values) === "warn";
  const ramSeries = {
    stepMinutes: host.memory.series.stepMinutes,
    values: host.memory.series.values.map((used) => shareOf(used, host.memory.totalMb)),
  };

  return (
    <DashboardSection title="Servidor" testId="server-metrics" action={<Freshness at={host.updatedAt} />}>
      <div className="grid gap-section p-[18px] sm:grid-cols-2">
        <MetricBlock
          label="Procesador"
          value={formatCount(cpu)}
          unit="%"
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
          value={formatCount(disk)}
          unit="%"
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

function Containers({ data }: { data: AvanzadasData }): ReactElement {
  const { runtime } = data;
  return (
    <DashboardSection title="Memoria por contenedor" testId="container-memory" action={<Freshness at={runtime.updatedAt} />}>
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
    </DashboardSection>
  );
}

function Users({ data, range }: { data: AvanzadasData; range: AvanzadasRange }): ReactElement {
  const { users } = data;
  const attempts = users.loginsOk + users.loginsFailed;
  const failedShare = shareOf(users.loginsFailed, attempts);
  const failedTone = toneForThresholds(failedShare, { warn: 15, bad: 30 });
  return (
    <DashboardSection title="Usuarios" testId="users-metrics" action={<Freshness at={users.updatedAt} />}>
      <div className="flex flex-col gap-field px-[18px] py-4">
        <span className="font-display text-2xl leading-none tabular-nums tracking-flat text-ink">
          {formatCount(users.connectedNow)}
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
        <dl className="m-0 divide-y divide-line">
          {ROLE_ROWS.map(({ key, label }) => (
            <Row key={key} label={label}>
              {formatCount(users.sessionsByRole[key])}
            </Row>
          ))}
        </dl>
      </div>
    </DashboardSection>
  );
}

function Backstage({ data }: { data: AvanzadasData }): ReactElement {
  const { runtime } = data;
  const { database, redis, queues } = runtime;
  const connectionsPercent = shareOf(database.connectionsUsed, database.connectionsMax);
  const redisPercent = shareOf(redis.usedMb, redis.maxMb);
  const ageTone = toneForThresholds(queues.oldestNotificationMinutes, NOTIFICATION_AGE_LIMITS);
  const connectionsFigures = `${database.connectionsUsed} de ${database.connectionsMax}`;
  const redisFigures = `${formatMegabytes(redis.usedMb)} de ${formatMegabytes(redis.maxMb)}`;

  return (
    <DashboardSection title="Base de datos, caché y colas" testId="backstage-metrics" action={<Freshness at={runtime.updatedAt} />}>
      <div className="flex flex-col gap-4 px-[18px] py-4">
        <div className="flex flex-col gap-field">
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="text-ink-2">Conexiones a la base de datos</span>
            <span className="font-semibold tabular-nums text-ink">{connectionsFigures}</span>
          </div>
          <UsageBar
            label={`Conexiones a la base de datos: ${connectionsFigures} (${connectionsPercent}%)`}
            used={database.connectionsUsed}
            limit={database.connectionsMax}
            tone={toneForThresholds(connectionsPercent, CAPACITY_LIMITS)}
          />
        </div>
        <div className="flex flex-col gap-field">
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="text-ink-2">Memoria de la caché (Redis)</span>
            <span className="font-semibold tabular-nums text-ink">{redisFigures}</span>
          </div>
          <UsageBar
            label={`Memoria de la caché: ${redisFigures} (${redisPercent}%)`}
            used={redis.usedMb}
            limit={redis.maxMb}
            tone={toneForThresholds(redisPercent, CAPACITY_LIMITS)}
          />
        </div>
      </div>
      <dl className="m-0 divide-y divide-line border-t border-line">
        <Row label="Tareas pendientes (Celery)">{formatCount(queues.celeryPending)}</Row>
        <Row label="Notificaciones pendientes">{formatCount(queues.notificationsPending)}</Row>
        <Row label="La más antigua espera">
          {ageTone !== "ok" ? <Badge tone={ageTone} className="mr-2">Atención</Badge> : null}
          {formatAge(queues.oldestNotificationMinutes)}
        </Row>
      </dl>
    </DashboardSection>
  );
}

export default function AvanzadasView({ data }: { data: AvanzadasData }): ReactElement {
  return (
    <div data-testid="advanced-work" className={PAGE_RAIL}>
      <div className="flex min-w-0 flex-col gap-page">
        <Service data={data} />
        <Server data={data} />
        <Containers data={data} />
      </div>
      <div className="flex min-w-0 flex-col gap-page">
        <Users data={data} range={data.range} />
        <Backstage data={data} />
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
              <b className="font-semibold text-ink">5xx</b>: fallas del servidor. <b className="font-semibold text-ink">4xx</b>:
              solicitudes rechazadas, por ejemplo una contraseña incorrecta.
            </dd>
          </dl>
        </InfoPanel>
      </div>
    </div>
  );
}
