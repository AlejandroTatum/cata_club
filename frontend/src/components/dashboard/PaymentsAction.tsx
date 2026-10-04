/**
 * PaymentsAction — the administrator's one pending job, as a full-width row.
 *
 * It sits under the day's timeline and uses its whole width on purpose: the
 * count as the figure, what it counts and how long the oldest has waited, who
 * sent the first receipts (initials and names), and the primary action at the
 * end. With nothing to review it collapses to a single calm line, so "nothing
 * to do" is stated rather than a band left empty.
 */

import type { ReactElement } from "react";
import Link from "next/link";
import { ArrowRight, CircleCheck } from "lucide-react";
import { ICON } from "@/lib/icon-size";
import { buttonClasses } from "@/components/ui";

export interface PaymentsActionSender {
  id: string;
  name: string;
  initials: string;
}

export interface PaymentsActionProps {
  /** Receipts waiting for validation. */
  count: number;
  /** The first senders, oldest first; the row shows at most three. */
  senders: readonly PaymentsActionSender[];
  /** "hace 12 días" — how long the oldest has waited, or `null` when unknown. */
  oldest: string | null;
  /** Receipts waiting more than a week. */
  overAWeek: number;
  href?: string;
}

const MAX_SENDERS = 3;

export default function PaymentsAction({ count, senders, oldest, overAWeek, href = "/payments" }: PaymentsActionProps): ReactElement {
  if (count === 0) {
    return (
      <p data-testid="payments-action" className="m-0 flex items-center gap-2.5 text-sm text-ink-2">
        <CircleCheck size={ICON.base} strokeWidth={1.5} className="flex-none text-state-ok" aria-hidden="true" />
        <span>
          <b className="font-semibold text-ink">Todo al día.</b> No hay comprobantes por revisar.
        </span>
      </p>
    );
  }

  const shown = senders.slice(0, MAX_SENDERS);
  const rest = Math.max(0, count - shown.length);
  const names = shown.map((sender) => sender.name).join(", ");

  return (
    <div
      data-testid="payments-action"
      className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-card border border-line-2 bg-sunken px-[18px] py-3.5"
    >
      <div className="flex items-center gap-3">
        <span className="font-display text-display leading-none tabular-nums tracking-flat text-ink">{count}</span>
        <div className="flex flex-col">
          <b className="text-sm font-bold text-ink">{count === 1 ? "Comprobante por revisar" : "Comprobantes por revisar"}</b>
          <span className="text-xs text-ink-2">
            {oldest ? `El más antiguo: ${oldest}` : "Esperan tu validación"}
            {overAWeek > 0 ? ` · ${overAWeek} ${overAWeek === 1 ? "lleva" : "llevan"} más de una semana esperando` : ""}
          </span>
        </div>
      </div>

      <div className="flex min-w-0 flex-1 items-center gap-3">
        {shown.length > 0 && (
          <ul aria-label="Quienes enviaron" className="m-0 flex list-none items-center p-0">
            {shown.map((sender) => (
              <li
                key={sender.id}
                title={sender.name}
                className="-ml-1.5 flex h-9 w-9 items-center justify-center rounded-full border-2 border-sunken bg-paper text-2xs font-bold text-ink-2 first:ml-0"
              >
                <span aria-hidden="true">{sender.initials}</span>
                <span className="sr-only">{sender.name}</span>
              </li>
            ))}
          </ul>
        )}
        {names && (
          <span className="min-w-0 truncate text-sm text-ink-2">
            De <b className="font-semibold text-ink">{names}</b>
            {rest > 0 ? ` y ${rest} más` : ""}
          </span>
        )}
      </div>

      <Link href={href} className={buttonClasses("primary")}>
        Revisar ahora
        <ArrowRight size={ICON.sm} strokeWidth={2} aria-hidden="true" />
      </Link>
    </div>
  );
}
