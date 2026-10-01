/**
 * StatusRowList — a short list of rows that each name a thing and its state:
 * "15:00 — 16:00 · Sub-12  [Lista tomada]".
 *
 * `ActivityList` is for "something happened" sentences with an avatar mark;
 * this is the other shape the dashboards need, a timetable-like row with a
 * badge and an optional action on the right. It keeps the same dense-row token
 * (`min-h-drow`) and gutter so the two read as one family in neighbouring
 * blocks.
 */

import type { ReactElement, ReactNode } from "react";
import { Badge, type BadgeTone } from "@/components/ui";

export interface StatusRow {
  id: string | number;
  /** The bold lead — usually a time range or a name. */
  title: string;
  /** A quieter second line. */
  detail?: string | null;
  status: { tone: BadgeTone; label: string };
  /** A row-level action, e.g. a "Pasar lista" link. */
  action?: ReactNode;
}

export default function StatusRowList({ rows }: { rows: StatusRow[] }): ReactElement {
  return (
    <ul className="divide-y divide-line">
      {rows.map((row) => (
        <li
          key={row.id}
          className="flex min-h-drow flex-wrap items-center gap-3 px-[18px] py-3"
        >
          <span className="min-w-0 flex-1 text-sm text-ink-2">
            <b className="block font-semibold tabular-nums text-ink">{row.title}</b>
            {row.detail ? <span className="block text-xs text-ink-3">{row.detail}</span> : null}
          </span>
          {row.action}
          <Badge tone={row.status.tone}>{row.status.label}</Badge>
        </li>
      ))}
    </ul>
  );
}
