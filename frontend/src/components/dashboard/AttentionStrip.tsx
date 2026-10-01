/**
 * AttentionStrip — what needs the reader's hands today, one row each.
 *
 * It replaces the full-width coal hero that carried a single number and left
 * the rest of the bar empty. A count and the action that clears it belong on
 * the same line, so each row is: the count in a badge, the sentence that reads
 * it, and the link that acts on it. Zero rows is itself the news, and says so
 * in one calm line instead of rendering nothing.
 */

import type { ReactElement } from "react";
import Link from "next/link";
import { ArrowRight, CircleCheck } from "lucide-react";
import { Badge, buttonClasses, type BadgeTone } from "@/components/ui";
import { ICON } from "@/lib/icon-size";
import DashboardSection from "./DashboardSection";

export interface AttentionItem {
  id: string;
  /** How many things are waiting. Rows with 0 are the caller's to drop. */
  count: number;
  /** The sentence that reads the count, e.g. "pagos esperan su validación". */
  label: string;
  /** An optional qualifier that gives a reason to act now. */
  note?: string | null;
  tone?: BadgeTone;
  href: string;
  cta: string;
}

export interface AttentionStripProps {
  title: string;
  items: AttentionItem[];
  /** What the strip says when there is nothing to do. */
  allClearMessage: string;
}

export default function AttentionStrip({
  title,
  items,
  allClearMessage,
}: AttentionStripProps): ReactElement {
  return (
    <DashboardSection title={title} testId="attention-strip">
      {items.length === 0 ? (
        <p className="m-0 flex items-center gap-3 px-[18px] py-4 text-sm text-ink-2">
          <CircleCheck size={ICON.base} strokeWidth={1.5} className="flex-none text-state-ok" aria-hidden="true" />
          {allClearMessage}
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {items.map((item) => (
            <li key={item.id} className="flex min-h-drow flex-wrap items-center gap-3 px-[18px] py-3">
              <Badge tone={item.tone ?? "warn"}>{item.count}</Badge>
              <span className="min-w-0 flex-1 text-sm text-ink-2">
                <b className="font-semibold text-ink">{item.label}</b>
                {item.note ? <span className="block text-xs text-ink-3">{item.note}</span> : null}
              </span>
              <Link href={item.href} className={buttonClasses("secondary", "sm")}>
                {item.cta}
                <ArrowRight size={ICON.sm} strokeWidth={2} aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </DashboardSection>
  );
}
