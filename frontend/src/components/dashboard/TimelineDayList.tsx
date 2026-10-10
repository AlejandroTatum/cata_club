/**
 * TimelineDayList - the phone's version of the "Hoy en el club" track.
 *
 * The timeline proportions each block by its duration, so on a 390px screen a
 * short session gets a chip too narrow to read ("Pendie..."). Below `lg` the
 * dashboard hides that track and shows the same sessions here instead: one
 * full-width row each, with the time, group and state written out. The rows
 * wear the track's own stickers (`TIMELINE_FACE` + glyph), so a state looks the
 * same in both drawings.
 */

import type { ReactElement } from "react";
import Link from "next/link";
import { cn } from "@/components/ui";
import { TIMELINE_FACE, TimelineGlyph } from "@/components/charts/Timeline";
import type { TimelineItem } from "@/components/charts/timeline-layout";

export interface TimelineDayListProps {
  items: readonly TimelineItem[];
  className?: string;
}

const ROW =
  "flex min-h-[44px] flex-col justify-center gap-0.5 rounded-ctl border-2 px-3 py-2 text-left shadow-sticker-sm";

function rowClasses(item: TimelineItem): string {
  return cn(ROW, TIMELINE_FACE[item.status]);
}

export default function TimelineDayList({ items, className }: TimelineDayListProps): ReactElement {
  return (
    <ul data-testid="timeline-day-list" className={cn("m-0 flex list-none flex-col gap-2 p-0", className)}>
      {items.map((item) => {
        const body = (
          <>
            <span className="flex items-center gap-1.5">
              <TimelineGlyph status={item.status} />
              <b className="text-sm font-extrabold tabular-nums">
                {item.start} – {item.end}
              </b>
            </span>
            <span className="text-sm font-semibold">{item.title}</span>
            <span className="text-xs font-bold">
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
