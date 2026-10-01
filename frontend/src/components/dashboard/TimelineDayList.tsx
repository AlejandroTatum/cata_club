/**
 * TimelineDayList — the phone's version of the "Hoy en el club" track.
 *
 * The timeline proportions each block by its duration, so on a 390px screen a
 * short session gets a chip too narrow to read ("Pendie…"). Below `lg` the
 * dashboard hides that track and shows the same sessions here instead: one
 * full-width row each, with the time, group and state written out. Colours come
 * from the same `groupTone` so a group looks the same in both drawings.
 */

import type { ReactElement } from "react";
import Link from "next/link";
import { cn } from "@/components/ui";
import { groupTone } from "@/components/charts/group-palette";
import type { TimelineItem } from "@/components/charts/timeline-layout";

export interface TimelineDayListProps {
  items: readonly TimelineItem[];
  className?: string;
}

const ROW =
  "flex min-h-[44px] flex-col justify-center gap-0.5 rounded-xl border-2 px-3 py-2 text-left text-ink";

function rowClasses(item: TimelineItem): string {
  const tone = groupTone(item.group ?? item.title);
  switch (item.status) {
    case "done":
      return cn(ROW, tone.solid);
    case "live":
      return cn(ROW, "bg-paper shadow-card ring-2 ring-coal/15", tone.border);
    case "missing":
      return cn(ROW, "border-dashed border-state-warn bg-state-warn-bg");
    default:
      return cn(ROW, "border-dashed", tone.border, tone.tint);
  }
}

export default function TimelineDayList({ items, className }: TimelineDayListProps): ReactElement {
  return (
    <ul data-testid="timeline-day-list" className={cn("m-0 flex list-none flex-col gap-2 p-0", className)}>
      {items.map((item) => {
        const body = (
          <>
            <b className="text-sm font-bold tabular-nums">
              {item.start} – {item.end}
            </b>
            <span className="text-sm font-semibold">{item.title}</span>
            <span className="text-xs font-semibold">
              {item.statusLabel}
              {item.note ? ` · ${item.note}` : ""}
            </span>
          </>
        );
        return (
          <li key={item.id} data-status={item.status}>
            {item.href ? (
              <Link href={item.href} className={rowClasses(item)}>
                {body}
              </Link>
            ) : (
              <div className={rowClasses(item)}>{body}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
