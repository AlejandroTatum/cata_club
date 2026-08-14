/**
 * "Distribución de Asistencias" donut — admin dashboard summary of the
 * attendance records already fetched for /attendance, split by estado.
 *
 * Hand-rolled SVG (no chart library in this project) — a plain `<circle>`
 * per segment via `stroke-dasharray`/`stroke-dashoffset`, per
 * dashboard-utils.ts#buildDonutArcs. Legend rows carry every value as text
 * (not hidden behind hover), so the chart is fully readable without
 * pointer/keyboard interaction; hover/focus on either the arc or its legend
 * row highlights both. None of that changes here — the reflow below is
 * presentation only.
 *
 * Two presentation fixes:
 *   · Stacked, never side-by-side. The card now shares its row with the
 *     activity feed, so the legend gets the column's full width instead of
 *     ~180px for three numeric columns.
 *   · Legend text migrated off the legacy `cata-*` palette onto the ink ramp.
 *     `text-cata-text/50` measured 3.05:1 — below AA. The percentage column is
 *     `ink-3-strong`, which holds on `paper` (5.26:1) AND on the `canvas` fill
 *     the row takes while hovered (4.83:1), where plain `ink-3` slips to 4.24.
 */

"use client";

import { useState } from "react";
import type { EstadoAsistencia } from "@/types/domain";
import type { AttendanceDayStats } from "@/app/attendance/attendance-utils";
import { buildAttendanceStatusSegments, buildDonutArcs } from "./dashboard-utils";

const SIZE = 140;
const STROKE_WIDTH = 20;
const RADIUS = (SIZE - STROKE_WIDTH) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

interface AttendanceStatusChartProps {
  stats: AttendanceDayStats;
}

export default function AttendanceStatusChart({ stats }: AttendanceStatusChartProps): React.ReactElement {
  const [hovered, setHovered] = useState<EstadoAsistencia | null>(null);
  const segments = buildAttendanceStatusSegments(stats);
  const arcs = buildDonutArcs(
    segments.map((s) => s.value),
    CIRCUMFERENCE,
  );

  return (
    <div className="flex flex-col items-center gap-page">
      <svg
        width={SIZE}
        height={SIZE}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="shrink-0 -rotate-90"
        role="img"
        aria-label={`Distribución de asistencias: ${segments.map((s) => `${s.label} ${s.percentage}%`).join(", ")}`}
      >
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          fill="none"
          stroke="var(--dashboard-donut-track, #e1e0d9)"
          strokeWidth={STROKE_WIDTH}
        />
        {segments.map((segment, i) => {
          const isHovered = hovered === segment.estado;
          return (
            <circle
              key={segment.estado}
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={RADIUS}
              fill="none"
              stroke={segment.color}
              strokeWidth={isHovered ? STROKE_WIDTH + 3 : STROKE_WIDTH}
              strokeDasharray={arcs[i].dashArray}
              strokeDashoffset={arcs[i].dashOffset}
              className="transition-[stroke-width] duration-150"
              onMouseEnter={() => setHovered(segment.estado)}
              onMouseLeave={() => setHovered((prev) => (prev === segment.estado ? null : prev))}
              onFocus={() => setHovered(segment.estado)}
              onBlur={() => setHovered((prev) => (prev === segment.estado ? null : prev))}
              tabIndex={segment.value > 0 ? 0 : -1}
            >
              <title>
                {segment.label}: {segment.value} ({segment.percentage}%)
              </title>
            </circle>
          );
        })}
        {/* Counter-rotates the whole label group +90° around the SAME
            center the parent `<svg>` rotates -90° around, so the two
            transforms cancel exactly and both texts land in plain,
            unrotated SVG coordinates. The previous approach rotated EACH
            `<text>` individually around its own `fill-box` center — since
            the number and the label have different box sizes, their
            "centers" differed, so the two texts drifted apart on the X
            axis instead of stacking: the number was left off-center and
            "REGISTROS" spilled sideways underneath it ("218TROS"). */}
        <g transform={`rotate(90 ${SIZE / 2} ${SIZE / 2})`}>
          <text
            x={SIZE / 2}
            y={SIZE / 2 - 8}
            textAnchor="middle"
            dominantBaseline="middle"
            className="fill-ink font-display text-xl tracking-flat"
          >
            {stats.totalStudents}
          </text>
          <text
            x={SIZE / 2}
            y={SIZE / 2 + 14}
            textAnchor="middle"
            dominantBaseline="middle"
            className="fill-ink-3-strong text-2xs font-bold uppercase tracking-caps-wide"
          >
            Registros
          </text>
        </g>
      </svg>

      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-line text-2xs font-bold uppercase tracking-caps-wide text-ink-3-strong">
            <th className="py-2 font-bold">Estado</th>
            <th className="py-2 text-right font-bold">Registros</th>
            <th className="py-2 text-right font-bold">Porcentaje</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {segments.map((segment) => {
            const isHovered = hovered === segment.estado;
            return (
              <tr
                key={segment.estado}
                onMouseEnter={() => setHovered(segment.estado)}
                onMouseLeave={() => setHovered((prev) => (prev === segment.estado ? null : prev))}
                className={`transition-colors ${isHovered ? "bg-canvas" : ""}`}
              >
                <td className="py-2">
                  <span className="flex items-center gap-2.5 text-ink-2">
                    <span
                      aria-hidden="true"
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: segment.color }}
                    />
                    {segment.label}
                  </span>
                </td>
                <td className="py-2 text-right font-semibold text-ink">{segment.value}</td>
                <td className="py-2 text-right text-xs text-ink-3-strong">{segment.percentage}%</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
