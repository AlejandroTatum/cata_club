/**
 * StackedBars — one stacked column per period, one layer per state.
 *
 * Built for "how did attendance split, week by week". It carries its own
 * interaction because the interaction is the point:
 *
 *   · the legend is a row of toggle chips (`aria-pressed`); switching a state
 *     off removes its layer and the columns rescale, so a small state is not
 *     flattened by the big one;
 *   · each column is a focusable hit target; hover and focus open a tooltip that
 *     lists every visible layer, and the same sentence is its accessible name;
 *   · the numbers are also available as a real table inside a `<details>`, for
 *     anyone who would rather read than hover.
 *
 * The drawing itself is an `aria-hidden` SVG (`preserveAspectRatio="none"`, so
 * it fills whatever width the card gives it), which is why the labels and the
 * tooltip are HTML on top of it.
 */

"use client";

import { useMemo, useState, type ReactElement } from "react";
import { cn } from "@/components/ui";
import ChartTooltip from "./ChartTooltip";
import { TONE_BG, TONE_FILL, seriesStyle, tooltipLeft, useActiveIndex, type ChartSeries } from "./chart-utils";

export interface StackedColumn {
  key: string;
  /** Axis label, e.g. "14/09". */
  label: string;
  /** Count per series key. Missing keys count as 0. */
  values: Record<string, number>;
}

export interface StackedBarsProps {
  series: readonly ChartSeries[];
  columns: readonly StackedColumn[];
  /** One-line summary of the whole chart. */
  ariaLabel: string;
  /** Caption of the table fallback, e.g. "Asistencia por estado y semana". */
  tableCaption: string;
  /** Label of the table's first column, e.g. "Semana". */
  periodLabel: string;
  /** What the layers count, for the tooltip total ("registros"). */
  unit?: string;
  heightClass?: string;
  /**
   * From `lg` up, let the plot take whatever height its card has left (never
   * less than `heightClass`), so the legend and the table stay at the foot of a
   * card stretched beside a taller neighbour. Below `lg` the height is fixed.
   */
  fill?: boolean;
  className?: string;
}

const VIEW_HEIGHT = 100;

export default function StackedBars({
  series,
  columns,
  ariaLabel,
  tableCaption,
  periodLabel,
  unit = "registros",
  heightClass = "h-44",
  fill = false,
  className,
}: StackedBarsProps): ReactElement {
  const { active, show, hide } = useActiveIndex();
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const visible = useMemo(() => series.filter((s) => !hidden.has(s.key)), [series, hidden]);

  const totals = columns.map((column) => visible.reduce((sum, s) => sum + (column.values[s.key] ?? 0), 0));
  const ceiling = Math.max(...totals, 0);
  const slot = 100 / Math.max(columns.length, 1);

  const toggle = (key: string): void =>
    setHidden((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const sentence = (column: StackedColumn, index: number): string => {
    const parts = visible.map((s) => `${s.label} ${column.values[s.key] ?? 0}`);
    return `${column.label}: ${parts.length ? parts.join(", ") : "sin estados visibles"} · ${totals[index]} ${unit}`;
  };

  return (
    <div data-testid="stacked-bars" className={cn("flex flex-col gap-3", fill && "lg:flex-1", className)}>
      <div role="group" aria-label={`${ariaLabel}. Usa los botones de estado para mostrar u ocultar capas.`} className={cn("flex flex-col gap-1.5", fill && "lg:flex-1")}>
        <div className={cn("relative", heightClass, fill && "lg:h-auto lg:min-h-44 lg:flex-1")}>
          <svg
            aria-hidden="true"
            viewBox={`0 0 100 ${VIEW_HEIGHT}`}
            preserveAspectRatio="none"
            className="absolute inset-0 h-full w-full"
          >
            {[25, 50, 75].map((y) => (
              <line key={y} x1="0" x2="100" y1={y} y2={y} strokeWidth="1" vectorEffect="non-scaling-stroke" strokeDasharray="2 4" className="stroke-line" />
            ))}
            <line x1="0" x2="100" y1={VIEW_HEIGHT} y2={VIEW_HEIGHT} strokeWidth="1" vectorEffect="non-scaling-stroke" className="stroke-line-2" />
            {columns.map((column, index) => {
              let floor = VIEW_HEIGHT;
              return (
                <g key={column.key}>
                  {visible.map((s) => {
                const value = column.values[s.key] ?? 0;
                if (value <= 0 || ceiling <= 0) return null;
                const height = (value / ceiling) * VIEW_HEIGHT;
                floor -= height;
                return (
                  <rect
                    key={`${column.key}-${s.key}`}
                    x={index * slot + slot * 0.2}
                    width={slot * 0.6}
                    y={floor}
                    height={Math.max(height - 0.6, 0.4)}
                    className={s.tone ? TONE_FILL[s.tone] : TONE_FILL.coal}
                    style={seriesStyle(s)}
                    opacity={active === null || active === index ? 1 : 0.55}
                  />
                );
                  })}
                </g>
              );
            })}
          </svg>

          <div className="absolute inset-0 flex">
            {columns.map((column, index) => (
              <span
                key={column.key}
                role="img"
                tabIndex={0}
                aria-label={sentence(column, index)}
                data-testid="stacked-column"
                className="flex-1 rounded-md"
                onMouseEnter={() => show(index)}
                onMouseLeave={() => hide(index)}
                onFocus={() => show(index)}
                onBlur={() => hide(index)}
              />
            ))}
          </div>

          {active !== null && columns[active] && (
            <ChartTooltip left={tooltipLeft(active, columns.length)}>
              <span className="block font-bold">{columns[active].label}</span>
              {visible.map((s) => (
                <span key={s.key} className="block tabular-nums">
                  {s.label}: {columns[active].values[s.key] ?? 0}
                </span>
              ))}
            </ChartTooltip>
          )}
        </div>

        <div aria-hidden="true" className="flex text-2xs tabular-nums text-ink-3-strong">
          {columns.map((column) => (
            <span key={column.key} className="flex-1 text-center">
              {column.label}
            </span>
          ))}
        </div>
      </div>

      <ul className="m-0 flex list-none flex-wrap gap-2 p-0" aria-label="Estados">
        {series.map((s) => {
          const on = !hidden.has(s.key);
          const count = columns.reduce((sum, column) => sum + (column.values[s.key] ?? 0), 0);
          return (
            <li key={s.key}>
              <button
                type="button"
                aria-pressed={on}
                onClick={() => toggle(s.key)}
                className={cn(
                  "touch-target-row inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold motion-safe:transition-colors",
                  on ? "border-line-2 bg-paper text-ink hover:bg-sunken" : "border-line bg-sunken text-ink-3-strong line-through",
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn("h-2 w-2 flex-none rounded-full", s.tone ? TONE_BG[s.tone] : TONE_BG.coal, !on && "opacity-40")}
                  style={seriesStyle(s)}
                />
                {s.label}
                <span className="tabular-nums font-normal text-ink-3-strong">{count}</span>
              </button>
            </li>
          );
        })}
      </ul>

      <details className="text-xs text-ink-2">
        <summary className="touch-target-pad cursor-pointer font-semibold text-ink-2">Ver como tabla</summary>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-left text-xs tabular-nums">
            <caption className="sr-only">{tableCaption}</caption>
            <thead>
              <tr className="border-b border-line text-ink-3-strong">
                <th scope="col" className="py-1.5 pr-3 font-bold">
                  {periodLabel}
                </th>
                {series.map((s) => (
                  <th key={s.key} scope="col" className="py-1.5 pr-3 text-right font-bold">
                    {s.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {columns.map((column) => (
                <tr key={column.key}>
                  <th scope="row" className="py-1.5 pr-3 font-semibold text-ink">
                    {column.label}
                  </th>
                  {series.map((s) => (
                    <td key={s.key} className="py-1.5 pr-3 text-right">
                      {column.values[s.key] ?? 0}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
