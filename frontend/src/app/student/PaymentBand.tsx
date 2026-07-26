/**
 * The family portal's "one thing to do next" band.
 *
 * The product already had this primitive twice — the admin's `/dashboard`
 * opens with a coal band carrying one figure, one sentence and one red CTA
 * ("12 · Pagos esperan tu validación · Revisar ahora"), and the trainer's
 * `/trainer` opens with the same shape ("18:00 · Sábado 18:00 — 20:00 · Pasar
 * lista"). The family portal was the only authenticated area that opened with
 * no such band at all: it led with the carnet, and the route to paying was an
 * underlined text link in the second card, sitting *below* two secondary
 * buttons that read far more like the page's action than it did.
 *
 * So this is not a new pattern. It is the product's own pattern, finally
 * applied to the screen whose reader has the most at stake in it, and it is
 * the answer to "no se indica bien cómo ir a hacer el pago, muy confuso":
 * whether anything is owed, what the plan costs, and the button, all above
 * the fold and one click from the action.
 *
 * ## Honesty rules this band inherits
 *
 * `describePaymentSituation` (student-utils.ts) owns every word and every
 * number here, and it cannot state an amount due because the backend has no
 * debt concept. The band therefore leads with a COUNTED figure — days of
 * coverage left, days overdue, or payments in review — never with a currency
 * amount, and the price line is labelled as a plan price. Red is spent only
 * on `urgent` states, so a family that is up to date is not shouted at.
 */

"use client";

import Link from "next/link";
import { ArrowRight, CreditCard } from "lucide-react";
import { buttonClasses } from "@/components/ui";
import type { PaymentSituation } from "./student-utils";

export interface PaymentBandProps {
  situation: PaymentSituation;
  /**
   * Where the CTA goes. `/student` sends the reader to the payments screen
   * with the form already open; `/student/payments` passes `null` because the
   * form is on the screen already.
   */
  action: { href: string; label: string } | null;
}

export default function PaymentBand({ situation, action }: PaymentBandProps): React.ReactElement {
  const { figure, headline, detail, priceNote, urgent } = situation;

  return (
    <section
      data-testid="student-payment-band"
      aria-label="Su situación de pagos"
      className="flex flex-wrap items-center gap-x-6 gap-y-4 rounded-card bg-coal px-6 py-6 text-white"
    >
      {figure && (
        <p className="flex flex-none flex-col gap-1">
          <span className="text-[56px] font-extrabold leading-none tracking-[-0.05em] tabular-nums">
            {figure.value}
          </span>
          {/* 60%, not the 45% the prototype uses for muted white: this line is
              9.5px and carries the figure's unit, which is the half of the
              pair that says what the number counts. */}
          <span className="text-[9.5px] font-bold uppercase tracking-[0.12em] text-white/60">
            {figure.unit}
          </span>
        </p>
      )}

      {/* Capped, and the flex basis is the cap: the band spans the full content
          column now, and an uncapped 13px detail line ran to ~95 characters
          there — past the measure the rest of the product reads at. The CTA
          takes the slack instead (`ml-auto` below), so the width buys
          separation between the fact and the errand rather than long lines. */}
      <div className="flex min-w-[220px] max-w-[62ch] flex-1 flex-col gap-1.5">
        <b className="text-[17px] font-bold tracking-[-0.015em]">{headline}</b>
        <span className="text-[13px] leading-relaxed text-white/60">{detail}</span>
        {priceNote && (
          <span className="flex items-center gap-2 text-[13px] text-white/60">
            <span aria-hidden="true" className="h-1.5 w-1.5 flex-none rounded-full bg-ball" />
            {priceNote}
          </span>
        )}
      </div>

      {action && (
        <Link
          href={action.href}
          className={buttonClasses(
            // Red is the primary CTA, and this is one — but only while there
            // is something to do. A family whose coverage runs to August gets
            // the same destination in the quiet variant.
            urgent ? "primary" : "secondary",
            "md",
            "ml-auto flex-none",
          )}
        >
          {urgent ? (
            <CreditCard size={16} strokeWidth={1.5} aria-hidden="true" />
          ) : null}
          {action.label}
          <ArrowRight size={15} strokeWidth={2} aria-hidden="true" />
        </Link>
      )}
    </section>
  );
}
