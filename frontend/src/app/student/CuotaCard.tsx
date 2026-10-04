/**
 * CuotaCard — the family portal's "Mensualidad" card (FAM-27; it was «Cuota»).
 *
 * A calm, compact card with ONE urgency signal. It states the situation as a
 * headline with a single coloured badge (Vencida / Vence en N días / Al día),
 * puts the two figures a family checks — until when they are covered and what
 * the plan costs — side by side, and offers the one action as a content-sized
 * button. It used to be a red banner band over key/value rows, with the red
 * repeated in the banner, the figure line and the button: the same alarm said
 * three times. Now only the badge carries colour.
 *
 * The owner asked that the payment verdict live HERE and not on the carnet
 * («No tiene ningún pago aprobado — esa info muévala a la sección de pagos, no
 * al carnet.»): a payment state is perishable and an identity document is not
 * (decision #286). The tone comes from `paymentBandTone`, the badge wording
 * from `describeCuotaBadge`.
 *
 * ## Honesty rules inherited from `describePaymentSituation`
 *
 * No amount OWED is ever stated, because the backend has no debt concept. "A
 * pagar" reads the plan's monthly price (`Membresia.montoAplicado`) directly,
 * stated as a price like the rest of the product does, never as a balance.
 *
 * Issue #400 (slice 4c-b): `montoAplicado` stays the real tariff even when
 * `Membresia.esGratuidadFamiliar` is `true`, so this card reads THAT flag
 * through `situation.kind === "gratuitous"` and drops the price entirely
 * rather than printing one next to a verdict that already says "no paga".
 *
 * The sentence under the headline (`situation.detail`) is dropped when the
 * "Cubierta hasta" figure already states the same date — for `expired`,
 * `ending-soon` and `covered` it is that date in words.
 */

"use client";

import Link from "next/link";
import { ArrowRight, CreditCard } from "lucide-react";
import { ICON } from "@/lib/icon-size";
import { Badge, buttonClasses, cn } from "@/components/ui";
import { formatCurrency, formatDate } from "@/lib/format-utils";
import { MIN_TARGET_CLASS } from "@/lib/target-size";
import {
  COVERAGE_ENDING_SOON_DAYS,
  daysUntil,
  describeCuotaBadge,
  paymentBandTone,
  type PaymentSituation,
} from "./student-utils";

export interface CuotaCardProps {
  situation: PaymentSituation;
  /** The furthest `fechaFin` among approved payments (`resolveCoverageEnd`). */
  coverageEnd: string | null;
  /** `Membresia.montoAplicado` — the plan's MONTHLY PRICE. Never a balance. */
  monthlyPrice: string | null;
  /** Where the CTA goes, or `null` when there is nothing to register from here. */
  action: { href: string; label: string } | null;
  /** The plain "see the history" destination, always available. */
  viewPagosHref: string;
  /** FAM-11: the sentence for a rejected payment the family still has to redo, or `null`. */
  notice?: string | null;
  /** "Today" for the day count; only tests pass it. */
  today?: Date;
}

/** Kinds whose `detail` only restates the "Cubierta hasta" date the figure row already shows. */
const DETAIL_IS_THE_DATE = new Set<PaymentSituation["kind"]>(["expired", "ending-soon", "covered"]);

/** The kinds that have a coverage date to count down to and a plan price to pay. */
const COUNTDOWN_KINDS = new Set<PaymentSituation["kind"]>(["expired", "ending-soon", "covered"]);

/**
 * FAM-27: how much, until when and what comes next, in one sentence the family
 * can act on. «Vence en 12 días (03/11/2026). Pague $25,00 y suba el
 * comprobante; el club lo revisa y le avisamos aquí.»
 */
function describeNextStep(daysLeft: number, coverageEnd: string, price: string): string {
  const date = formatDate(coverageEnd);
  const when =
    daysLeft < 0
      ? `Venció hace ${-daysLeft} ${daysLeft === -1 ? "día" : "días"} (${date}).`
      : daysLeft === 0
        ? `Vence hoy (${date}).`
        : `Vence en ${daysLeft} ${daysLeft === 1 ? "día" : "días"} (${date}).`;
  return `${when} Pague ${price} y suba el comprobante; el club lo revisa y le avisamos aquí.`;
}

/** One figure: a small label over a large tabular number. */
function CuotaFigure({ label, value, note }: { label: string; value: string; note?: string }): React.ReactElement {
  return (
    <div className="min-w-0">
      <p className="text-2xs font-bold uppercase text-ink-3-strong">{label}</p>
      <p className="mt-0.5 flex items-baseline gap-1.5 text-xl font-bold tabular-nums tracking-tight text-ink">
        {value}
        {note ? <span className="text-xs font-normal text-ink-3-strong">{note}</span> : null}
      </p>
    </div>
  );
}

export default function CuotaCard({
  situation,
  coverageEnd,
  monthlyPrice,
  action,
  viewPagosHref,
  notice = null,
  today,
}: CuotaCardProps): React.ReactElement {
  const tone = paymentBandTone(situation);
  const badge = describeCuotaBadge(situation);
  const isGratuitous = situation.kind === "gratuitous";
  const monthlyPriceLabel = monthlyPrice && !isGratuitous ? formatCurrency(monthlyPrice) : null;
  const showDetail = !(coverageEnd && DETAIL_IS_THE_DATE.has(situation.kind));
  const hasFigures = Boolean(coverageEnd || monthlyPriceLabel);
  const daysLeft = daysUntil(coverageEnd, today);
  // The primary (red) button is the one nudge: only when 7 days or fewer remain.
  const dueSoon = daysLeft !== null && daysLeft <= COVERAGE_ENDING_SOON_DAYS;
  const nextStep =
    action && coverageEnd && monthlyPriceLabel && daysLeft !== null && COUNTDOWN_KINDS.has(situation.kind)
      ? describeNextStep(daysLeft, coverageEnd, monthlyPriceLabel)
      : null;

  return (
    <section
      data-testid="student-cuota-card"
      aria-label="Su mensualidad"
      className="card overflow-hidden"
    >
      <div className="flex items-center gap-3 border-b border-line px-5 py-3">
        <h2 className="flex-1 font-display text-lg uppercase leading-tight tracking-flat text-ink">Mensualidad</h2>
        <Link
          href={viewPagosHref}
          // `MIN_TARGET_CLASS` (issue #818, WCAG 2.5.8 AA): the link used to
          // be exactly its text, 56 × 18.8px.
          className={`inline-flex items-center text-xs font-semibold text-ink-2 underline decoration-line-2 decoration-2 underline-offset-4 hover:decoration-ink ${MIN_TARGET_CLASS}`}
        >
          Ver pagos
        </Link>
      </div>

      {/* ONE row that uses the width: verdict | figures | action. Wrapping
          (phones) stacks the same pieces; nothing is stretched to fill. */}
      <div className="flex flex-col gap-3 px-5 py-4">
        <div className="grid gap-x-8 gap-y-4 md:grid-cols-[minmax(0,1.3fr)_minmax(0,2fr)] md:items-center">
          <div className="flex flex-col items-start gap-3">
            <div
              data-testid="cuota-verdict"
              data-urgent={String(situation.urgent)}
              data-tone={tone}
              className="flex flex-wrap items-center gap-x-3 gap-y-2"
            >
              <Badge tone={badge.tone}>{badge.label}</Badge>
              <p className="text-sm font-semibold text-ink">{situation.headline}</p>
            </div>
            {action && (
              <Link href={action.href} className={buttonClasses(dueSoon ? "primary" : "secondary", "md")}>
                {situation.urgent ? (
                  <CreditCard size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />
                ) : null}
                {action.label}
                <ArrowRight size={ICON.sm} strokeWidth={2} aria-hidden="true" />
              </Link>
            )}
          </div>

          {hasFigures && (
            <div
              data-testid="cuota-figures"
              className={cn(
                "grid gap-x-8 gap-y-3",
                coverageEnd && monthlyPriceLabel ? "grid-cols-2" : "grid-cols-1",
              )}
            >
              {coverageEnd && <CuotaFigure label="Cubierta hasta" value={formatDate(coverageEnd)} />}
              {monthlyPriceLabel && <CuotaFigure label="A pagar" value={monthlyPriceLabel} note="al mes" />}
            </div>
          )}
        </div>
        {nextStep && (
          <p data-testid="cuota-next-step" className="text-sm leading-relaxed text-ink-2">
            {nextStep}
          </p>
        )}
        {showDetail && <p className="text-xs leading-relaxed text-ink-3-strong">{situation.detail}</p>}
        {notice && (
          <p
            data-testid="cuota-rejected-notice"
            className="rounded-ctl bg-state-warn-bg px-3 py-2 text-sm font-semibold text-ink"
          >
            {notice}
          </p>
        )}
      </div>
    </section>
  );
}
