/**
 * SectionSkeleton — the loading state of a dashboard block, at the height the
 * block will have once its data lands.
 *
 * A spinner block is a different height from the rows that replace it, and the
 * difference shifts everything below it (PERF-06, CLS 0.18). This reserves the
 * final height up front, so the swap changes content and not layout.
 */

import type { ReactElement } from "react";

export interface SectionSkeletonProps {
  /** What is being fetched, e.g. "Cargando actividad…". Read by screen readers. */
  label: string;
  /** Number of placeholder rows; each one is a dense row (56px). */
  rows: number;
}

const ROW_PX = 56;

export default function SectionSkeleton({ label, rows }: SectionSkeletonProps): ReactElement {
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="section-skeleton"
      style={{ minHeight: rows * ROW_PX }}
      className="flex flex-col divide-y divide-line"
    >
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, index) => (
        <div
          key={index}
          aria-hidden="true"
          className="flex h-drow items-center gap-3 px-[18px]"
        >
          <span className="h-8 w-8 flex-none animate-pulse rounded-full bg-state-neutral-bg" />
          <span className="h-3 w-2/3 animate-pulse rounded bg-state-neutral-bg" />
        </div>
      ))}
    </div>
  );
}
