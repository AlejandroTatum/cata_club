/**
 * CuotaCard — the family portal's "Cuota" card (Propuesta 2, "El carnet
 * manda" — docs/fixes/12-mi-cuenta-carnet.md).
 *
 * This used to be `PaymentBand`, a full-width coal band leading the page (see
 * git history for that shape). The redesign moves the one-glance verdict onto
 * the carnet itself (`Carnet`'s own status band, in page.tsx) and gives this
 * card a narrower job: the two facts a family checks once they already know
 * whether they owe anything — until when they are covered, and what the plan
 * costs — plus the one action.
 *
 * ## The compact mode
 *
 * The maquette's own recorded cost for "El carnet manda" is that it is heavy
 * when there is nothing to resolve, and in a club where most families pay on
 * time that is the majority of visits. This card is where that weight was
 * concentrated: cubierta hasta, a pagar, a whole paragraph and a full-width
 * button, for a state whose entire content is "you're fine".
 *
 * So the `covered` state compresses to a single line — cubierta hasta, and a
 * small text link, no paragraph, no button — and the vertical room it gives
 * up is what lets "Esta semana" carry more weight below it. Every other
 * `PaymentSituation.kind` still needs the full card: `awaiting-validation`,
 * `no-membership` and `minor-blocked` all have a real explanation to give
 * (who acts, or why there is nothing to act on yet), and every urgent kind
 * has an action to be taken. `compact` is therefore keyed to `kind ===
 * "covered"`, not to `!urgent` — those are not the same four states.
 *
 * ## Honesty rules inherited from `describePaymentSituation`
 *
 * Same as the band this replaces: no amount OWED is ever stated, because the
 * backend has no debt concept. "A pagar" reads the plan's monthly price
 * (`Membresia.montoAplicado`) directly, stated as a price like the rest of
 * the product does, never as a balance.
 */

"use client";

import Link from "next/link";
import { ArrowRight, CreditCard } from "lucide-react";
import { ICON } from "@/lib/icon-size";
import { buttonClasses, DataBox } from "@/components/ui";
import { formatCurrency, formatDate } from "@/lib/format-utils";
import type { PaymentSituation } from "./student-utils";

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
}

/** One label/value line — "Cubierta hasta" / "27/07/2026" — the value in its own `DataBox`. */
function CuotaRow({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs text-ink-3">{label}</span>
      <DataBox variant="numeric">{value}</DataBox>
    </div>
  );
}

export default function CuotaCard({
  situation,
  coverageEnd,
  monthlyPrice,
  action,
  viewPagosHref,
}: CuotaCardProps): React.ReactElement {
  const compact = situation.kind === "covered";
  const monthlyPriceLabel = monthlyPrice ? formatCurrency(monthlyPrice) : null;

  return (
    <section
      data-testid="student-cuota-card"
      data-compact={compact}
      aria-label="Su cuota"
      className="card overflow-hidden"
    >
      <div className="flex items-center gap-3 border-b border-line px-5 py-3">
        <h2 className="flex-1 text-sm font-bold text-ink">Cuota</h2>
        <Link
          href={viewPagosHref}
          className="text-xs font-semibold text-ink-2 underline decoration-line-2 decoration-2 underline-offset-4 hover:decoration-ink"
        >
          Ver pagos
        </Link>
      </div>

      {compact ? (
        // One line: the fact that still matters once there is nothing to
        // resolve, and a quiet way back to the form for a family paying
        // ahead. No paragraph, no button — the carnet's own pill already
        // said "Al día".
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
          <p className="text-sm text-ink-2">
            {coverageEnd ? (
              <>
                Cubierta hasta{" "}
                <b className="font-semibold tabular-nums text-ink">{formatDate(coverageEnd)}</b>
              </>
            ) : (
              situation.headline
            )}
          </p>
          {action && (
            <Link
              href={action.href}
              className="inline-flex min-h-[24px] items-center gap-1 text-xs font-semibold text-ink underline decoration-line-2 decoration-2 underline-offset-4 hover:decoration-ink"
            >
              {action.label}
              <ArrowRight size={ICON.sm} strokeWidth={1.75} aria-hidden="true" />
            </Link>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-3 px-5 py-4">
          {(coverageEnd || monthlyPriceLabel) && (
            <div className="flex flex-col gap-2">
              {coverageEnd && <CuotaRow label="Cubierta hasta" value={formatDate(coverageEnd)} />}
              {monthlyPriceLabel && <CuotaRow label="A pagar" value={monthlyPriceLabel} />}
            </div>
          )}
          <p className="text-xs leading-relaxed text-ink-3-strong">{situation.detail}</p>
          {action && (
            <Link
              href={action.href}
              className={buttonClasses(
                situation.urgent ? "primary" : "secondary",
                "md",
                "w-full justify-center",
              )}
            >
              {situation.urgent ? (
                <CreditCard size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />
              ) : null}
              {action.label}
              <ArrowRight size={ICON.sm} strokeWidth={2} aria-hidden="true" />
            </Link>
          )}
        </div>
      )}
    </section>
  );
}
