/**
 * Resumen — the club's use of the app, in words anyone can read.
 *
 * Four figures with the shape they are made of, the week drawn by role, and a
 * three-line verdict on the system. No jargon: whatever needs a technical
 * reader lives in "Métricas avanzadas".
 */

import type { ReactElement } from "react";
import { StackedBars, Bars, type BarDatum } from "@/components/charts";
import CompactEmpty from "@/components/dashboard/CompactEmpty";
import DashboardSection from "@/components/dashboard/DashboardSection";
import KpiTile from "@/components/dashboard/KpiTile";
import { Badge, InfoPanel, PAGE_RAIL, STAT_GRID, cn, type BadgeTone } from "@/components/ui";
import {
  formatCount,
  formatPeriodLabel,
  formatUpdatedAgo,
  minutesBetween,
  healthCopy,
  statusCopy,
} from "./activity-utils";
import type { HealthLevel, PeriodSpan, ResumenData, ResumenPeriod } from "./actividad-types";

const CHART_TITLE: Record<PeriodSpan, string> = {
  "2h": "Uso por franja horaria",
  "1d": "Uso por día",
  "6d": "Uso cada 6 días",
};

const COLUMN_NOTE: Record<PeriodSpan, string> = {
  "2h": "Cada columna reúne 2 horas.",
  "1d": "Cada columna es un día.",
  "6d": "Cada columna reúne 6 días.",
};

const RANGE_PHRASE: Record<ResumenData["range"], string> = {
  "24h": "las últimas 24 horas",
  "7d": "los últimos 7 días",
  "30d": "los últimos 30 días",
};

const STATUS_DOT: Record<HealthLevel, string> = {
  ok: "bg-state-ok",
  warn: "bg-state-warn",
  bad: "bg-state-bad",
  unknown: "bg-state-neutral",
};

const STATUS_WORD: Record<HealthLevel, string> = {
  ok: "Todo bien",
  warn: "Atención",
  bad: "Urgente",
  unknown: "Sin datos",
};

const visitorsOf = (period: ResumenPeriod): number =>
  period.visitors.alumnos + period.visitors.entrenadores + period.visitors.representantes;

function trendData(
  data: ResumenData,
  pick: (period: ResumenPeriod) => number,
  noun: string,
): BarDatum[] {
  return data.periods.map((period) => ({
    key: period.start,
    label: formatPeriodLabel(period.start, data.span),
    value: pick(period),
    detail: `${formatPeriodLabel(period.start, data.span)}: ${formatCount(pick(period))} ${noun}`,
  }));
}

function trendSummary(title: string, bars: readonly BarDatum[]): string {
  return `${title}: ${bars.map((bar) => `${bar.label} ${bar.value}`).join(", ")}`;
}

/** `now` is the instant the figures were fetched, so "hace N min" does not drift with the render. */
export default function ResumenView({
  data,
  now,
  metricsUnavailable = false,
}: {
  data: ResumenData;
  now: string;
  /** The advanced metrics failed to load: the status card says so instead of «Todo bien». */
  metricsUnavailable?: boolean;
}): ReactElement {
  const { uniqueVisitors, span } = data;
  const people = trendData(data, visitorsOf, "personas");
  const attendances = trendData(data, (p) => p.attendances, "asistencias");
  const payments = trendData(data, (p) => p.payments, "pagos");
  const enrollments = trendData(data, (p) => p.enrollments, "inscripciones");
  const sum = (pick: (p: ResumenPeriod) => number): number => data.periods.reduce((total, p) => total + pick(p), 0);
  const phrase = RANGE_PHRASE[data.range];
  const health = healthCopy(data.health);
  const quiet = data.periods.every((period) => visitorsOf(period) === 0);

  const tiles = [
    {
      label: "Personas que ingresaron",
      value: uniqueVisitors.total,
      bars: people,
      caption: `${formatCount(uniqueVisitors.alumnos)} jugadores · ${formatCount(uniqueVisitors.entrenadores)} entrenadores · ${formatCount(uniqueVisitors.representantes)} representantes`,
    },
    {
      label: "Asistencias registradas",
      value: sum((p) => p.attendances),
      bars: attendances,
      caption: `Anotadas en ${phrase}`,
    },
    {
      label: "Pagos registrados",
      value: sum((p) => p.payments),
      bars: payments,
      caption: `Registrados en ${phrase}`,
    },
    {
      label: "Inscripciones nuevas",
      value: sum((p) => p.enrollments),
      bars: enrollments,
      caption: `Altas en ${phrase}`,
    },
  ];

  return (
    <>
      <div data-testid="activity-kpis" className={STAT_GRID}>
        {tiles.map((tile) => (
          <KpiTile
            key={tile.label}
            label={tile.label}
            value={formatCount(tile.value)}
            visualPlacement="below"
            visual={
              <Bars
                data={tile.bars}
                ariaLabel={trendSummary(tile.label, tile.bars)}
                heightClass="h-10"
                hideLabels
              />
            }
            // Two lines of room in every tile, so the figures sit level whether a
            // caption wraps (the role split) or not.
            caption={<span className="block min-h-8">{tile.caption}</span>}
          />
        ))}
      </div>

      {/* `items-stretch` from lg: the usage card grows to the rail's height instead of ending above it. */}
      <div data-testid="activity-work" className={cn(PAGE_RAIL, "lg:items-stretch")}>
        <div className="flex min-w-0 flex-col gap-page [&>section]:flex-1">
          <DashboardSection title={CHART_TITLE[span]} testId="usage-chart">
            {quiet ? (
              <CompactEmpty
                title="Todavía no hay movimiento"
                description="El gráfico se dibuja con el primer ingreso."
              />
            ) : (
              <div className="flex flex-1 flex-col p-[18px]">
                <StackedBars
                  fill
                  series={[
                    { key: "alumnos", label: "Jugadores", tone: "coal" },
                    { key: "entrenadores", label: "Entrenadores", tone: "neutral" },
                    { key: "representantes", label: "Representantes", tone: "muted" },
                  ]}
                  columns={data.periods.map((period) => ({
                    key: period.start,
                    label: formatPeriodLabel(period.start, span),
                    values: { ...period.visitors },
                  }))}
                  ariaLabel={`Personas que ingresaron en ${phrase}, por rol`}
                  tableCaption={`Personas que ingresaron por rol, ${phrase}`}
                  periodLabel="Período"
                  unit="ingresos"
                />
                <p className="m-0 mt-section text-xs text-ink-3-strong">
                  {COLUMN_NOTE[span]} Una persona que ingresa varias veces cuenta una vez por columna.
                </p>
              </div>
            )}
          </DashboardSection>
        </div>

        <div className="flex min-w-0 flex-col gap-page">
          <DashboardSection
            title="Estado del sistema"
            testId="system-status"
            action={
              <span className="text-xs text-ink-3-strong">
                {formatUpdatedAgo(minutesBetween(data.generatedAt, now))}
              </span>
            }
          >
            <ul className="m-0 flex list-none flex-col divide-y divide-line p-0">
              {data.status.map(({ key, level }) => {
                const copy = statusCopy(key, level);
                return (
                  <li key={key} className="flex items-start gap-3 px-[18px] py-3.5">
                    <span aria-hidden="true" className={cn("mt-1.5 h-2 w-2 flex-none rounded-full", STATUS_DOT[level])} />
                    <div className="flex min-w-0 flex-1 flex-col gap-field">
                      <p className="m-0 text-sm font-semibold text-ink">
                        <span className="sr-only">{STATUS_WORD[level]}: </span>
                        {copy.sentence}
                      </p>
                      {copy.action ? <p className="m-0 text-xs text-ink-2">{copy.action}</p> : null}
                    </div>
                    {level !== "ok" && level !== "unknown" ? <Badge tone={level as BadgeTone}>{STATUS_WORD[level]}</Badge> : null}
                  </li>
                );
              })}
              {health ? (
                <li data-testid="system-health" className="flex items-start gap-3 px-[18px] py-3.5">
                  <span aria-hidden="true" className={cn("mt-1.5 h-2 w-2 flex-none rounded-full", STATUS_DOT.warn)} />
                  <div className="flex min-w-0 flex-1 flex-col gap-field">
                    <p className="m-0 text-sm font-semibold text-ink">
                      <span className="sr-only">{STATUS_WORD.warn}: </span>
                      {health.sentence}
                    </p>
                    <p className="m-0 text-xs text-ink-2">{health.action}</p>
                  </div>
                  <Badge tone="warn">{STATUS_WORD.warn}</Badge>
                </li>
              ) : null}
              {metricsUnavailable ? (
                <li className="flex items-start gap-3 px-[18px] py-3.5">
                  <span aria-hidden="true" className={cn("mt-1.5 h-2 w-2 flex-none rounded-full", STATUS_DOT.warn)} />
                  <div className="flex min-w-0 flex-1 flex-col gap-field">
                    <p className="m-0 text-sm font-semibold text-ink">
                      <span className="sr-only">{STATUS_WORD.warn}: </span>
                      No se pudieron leer las métricas de la aplicación.
                    </p>
                    <p className="m-0 text-xs text-ink-2">Abre «Métricas avanzadas» para ver el detalle y reintentar.</p>
                  </div>
                  <Badge tone="warn">{STATUS_WORD.warn}</Badge>
                </li>
              ) : null}
            </ul>
            {data.queuedByQuota > 0 ? (
              <p data-testid="queued-by-quota" className="m-0 border-t border-line px-[18px] py-3.5 text-xs text-ink-2">
                {data.queuedByQuota === 1
                  ? "1 correo espera el reinicio del límite diario y se enviará mañana."
                  : `${data.queuedByQuota} correos esperan el reinicio del límite diario y se enviarán mañana.`}
              </p>
            ) : null}
          </DashboardSection>

          <InfoPanel title="Qué muestra esta pantalla">
            <p>
              Un resumen de cómo usa el club la aplicación: quiénes ingresan, cuántas asistencias y pagos se
              registran y si todo funciona con normalidad.
            </p>
            <p>
              Cambia el período con los botones de arriba. Para ver el detalle técnico, abre «Métricas
              avanzadas».
            </p>
          </InfoPanel>
        </div>
      </div>
    </>
  );
}
