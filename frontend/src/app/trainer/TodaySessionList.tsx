/**
 * The day as a vertical list - what "Hoy" shows on a phone.
 *
 * `Timeline` draws the day along its hours and scrolls sideways below `sm`;
 * the "Ahora" chip covers the next hour and the afternoon sessions sit out of
 * sight with nothing saying so (QA4 ENT-12). The same items as rows read top to
 * bottom, in start order, with the state in words and the same link into the
 * wizard. The rows wear the timeline's own stickers, so a state looks the same
 * in both drawings. From `sm` up the timeline takes over and this list is
 * hidden.
 */

import Link from "next/link";
import { TIMELINE_FACE, TimelineGlyph, type TimelineItem } from "@/components/charts/Timeline";
import { cn } from "@/components/ui";

export default function TodaySessionList({ items }: { items: readonly TimelineItem[] }): React.ReactElement {
  const ordered = [...items].sort((a, b) => a.start.localeCompare(b.start));
  const taken = items.filter((item) => item.status === "done").length;

  return (
    <div data-testid="today-list" className="flex flex-col gap-2 sm:hidden">
      <p className="m-0 text-sm text-ink-2">
        <b className="font-extrabold text-ink">
          {taken} de {items.length}
        </b>{" "}
        listas tomadas
      </p>
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
      {ordered.map((item) => (
        <li key={item.id}>
          <Link
            data-testid="today-list-row"
            data-status={item.status}
            href={item.href ?? "#"}
            className={cn(
              "flex min-h-drow items-center justify-between gap-3 rounded-ctl border-2 px-3 py-2 shadow-sticker-sm",
              TIMELINE_FACE[item.status],
            )}
          >
            <span className="flex min-w-0 flex-col">
              <span className="flex items-center gap-1.5">
                <TimelineGlyph status={item.status} />
                <b className="text-sm font-extrabold tabular-nums">
                  {item.start} — {item.end}
                </b>
              </span>
              <span className="truncate text-xs font-semibold">
                {item.title}
                {item.note ? ` · ${item.note}` : ""}
              </span>
            </span>
            <span className="flex-none text-xs font-bold">{item.statusLabel}</span>
          </Link>
        </li>
      ))}
      </ul>
    </div>
  );
}
