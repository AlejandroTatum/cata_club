/**
 * The day as a vertical list — what "Hoy" shows on a phone.
 *
 * `Timeline` draws the day along its hours and scrolls sideways below `sm`;
 * the "Ahora" chip covers the next hour and the afternoon sessions sit out of
 * sight with nothing saying so (QA4 ENT-12). The same items as rows read top to
 * bottom, in start order, with the state in words and the same link into the
 * wizard. From `sm` up the timeline takes over and this list is hidden.
 */

import Link from "next/link";
import type { TimelineItem } from "@/components/charts";

const STATUS_TEXT_CLASS: Record<TimelineItem["status"], string> = {
  done: "text-state-ok",
  live: "text-ink",
  pending: "text-ink-2",
  missing: "text-state-bad",
};

export default function TodaySessionList({ items }: { items: readonly TimelineItem[] }): React.ReactElement {
  const ordered = [...items].sort((a, b) => a.start.localeCompare(b.start));
  const taken = items.filter((item) => item.status === "done").length;

  return (
    <div data-testid="today-list" className="flex flex-col gap-2 sm:hidden">
      <p className="m-0 text-sm text-ink-2">
        <b className="font-semibold text-ink">
          {taken} de {items.length}
        </b>{" "}
        listas tomadas
      </p>
      <ul className="m-0 flex list-none flex-col p-0">
      {ordered.map((item) => (
        <li key={item.id} className="border-b border-line last:border-b-0">
          <Link
            data-testid="today-list-row"
            href={item.href ?? "#"}
            className="flex min-h-drow items-center justify-between gap-3 py-2"
          >
            <span className="flex min-w-0 flex-col">
              <b className="text-sm font-bold tabular-nums text-ink">
                {item.start} — {item.end}
              </b>
              <span className="truncate text-xs text-ink-2">
                {item.title}
                {item.note ? ` · ${item.note}` : ""}
              </span>
            </span>
            <span className={`flex-none text-xs font-semibold ${STATUS_TEXT_CLASS[item.status]}`}>
              {item.statusLabel}
            </span>
          </Link>
        </li>
      ))}
      </ul>
    </div>
  );
}
