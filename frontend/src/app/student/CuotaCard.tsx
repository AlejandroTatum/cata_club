/**
 * CuotaCard — the family portal's "Cuota" card (Propuesta 2, "El carnet
 * manda" — docs/archive/fixes/12-mi-cuenta-carnet.md).
 *
 * This used to be `PaymentBand`, a full-width coal band leading the page (see
 * git history for that shape). The redesign moves the one-glance verdict onto
 * the carnet itself (`Carnet`'s own status band, in page.tsx) and gives this
 * card a narrower job: the two facts a family checks once they already know
 * whether they owe anything — until when they are covered, and what the plan
 * costs — plus the one action.
 *
 * ## AND IT CAME BACK, on the argument that already governed the paper card
 *
 * The paragraph above is history, not the current shape. The owner read the
 * running screen and said it in one line: «No tiene ningún pago aprobado —
 * esa info muévala a la sección de pagos, no al carnet.» The verdict leads
 * THIS card now, and the carnet renders no payment state in either medium.
 *
 * What flipped is not a preference, it is the scope of an argument the
 * codebase had already accepted. Decision #286 kept the status band off the
 * PRINTED carnet because a payment state is perishable and an identity
 * document is not — a plasticised card reading «vencido» ages badly. That
 * argument never depended on the medium. A carnet is an identity document on
 * screen too; belonging is an identity fact and this month's coverage is not.
 * So the same reasoning that kept the state off the paper card now keeps it
 * off the screen card, and the payments block is where it belongs.
 *
 * The tone comes from `paymentBandTone` — the band's own function, unchanged
 * and unmoved. What was carnet-specific was the band's HOST, never its reading
 * of the situation. What did NOT come across is the coal-surface palette: the
 * band sat on the carnet's gradient and hand-picked its foregrounds, while
 * this card sits on `paper`, where the `state-*` tokens `Badge` already uses
 * are the measured pairs (`color-contrast.test.ts`).
 *
 * ## The compact mode
 *
 * The maquette's own recorded cost for "El carnet manda" is that it is heavy
 * when there is nothing to resolve, and in a club where most families pay on
 * time that is the majority of visits. This card is where that weight was
 * concentrated: cubierta hasta, a pagar, a whole paragraph and a full-width
 * button, for a state whose entire content is "you're fine".
 *
 * So the `covered` state compresses to the verdict plus a single line —
 * cubierta hasta, and a small text link, no paragraph, no button — and the
 * vertical room it gives up is what lets "Esta semana" carry more weight
 * below it. The verdict is the one thing compression may not take: it used to
 * be free because the carnet's pill was saying it, and once that pill left,
 * dropping it here left the state stated nowhere at all. Every other
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
 *
 * Issue #400 (slice 4c-b) added one more thing "A pagar" must never state: a
 * real price for a membership that does not charge one. `montoAplicado`
 * stays the real tariff even when `Membresia.esGratuidadFamiliar` is `true`
 * (the flag stopped zeroing it), so this card reads THAT flag through
 * `situation.kind === "gratuitous"` and drops the row entirely rather than
 * printing a price next to a verdict that already says "no paga".
 */

"use client";

import Link from "next/link";
import { AlertTriangle, ArrowRight, CreditCard } from "lucide-react";
import { ICON } from "@/lib/icon-size";
import { buttonClasses, cn, DataBox } from "@/components/ui";
import { formatCurrency, formatDate } from "@/lib/format-utils";
import { paymentBandTone, type PaymentSituation } from "./student-utils";

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

/**
 * THE VERDICT — what is true right now, stated before any evidence.
 *
 * It is the carnet's old status band, rehoused. One shape for every state,
 * because this card is the payments block and a family reading it is reading
 * it for exactly this: the tone tells the three groups apart, not the layout.
 * (The band needed two shapes because it also had to stop weighing down an
 * identity card in the majority case. That constraint left with the band.)
 *
 * The palette is the `state-*` token pairs `Badge` uses and
 * `color-contrast.test.ts` measures, NOT the band's hand-picked `#FF8A93` and
 * `#7BE8A4`. Those two were chosen to sit on the carnet's coal gradient; this
 * card is on `paper`, where the tokens are the measured answer and a
 * transcribed coal foreground would be a fresh unmeasured pair.
 */
function CuotaVerdict({ situation }: { situation: PaymentSituation }): React.ReactElement {
  const tone = paymentBandTone(situation);

  return (
    <div
      data-testid="cuota-verdict"
      data-urgent={String(situation.urgent)}
      data-tone={tone}
      className={cn(
        "flex items-start gap-2.5 border-b border-line px-5 py-3",
        tone === "bad" && "bg-state-bad-bg",
        tone === "ok" && "bg-state-ok-bg",
        tone === "neutral" && "bg-sunken",
      )}
    >
      {tone === "bad" ? (
        <AlertTriangle
          size={ICON.sm}
          strokeWidth={2}
          className="mt-0.5 flex-none text-state-bad"
          aria-hidden="true"
        />
      ) : null}
      <div className="min-w-0">
        <p
          className={cn(
            "text-sm font-bold leading-tight",
            tone === "bad" && "text-state-bad",
            tone === "ok" && "text-state-ok",
            tone === "neutral" && "text-ink",
          )}
        >
          {situation.headline}
        </p>
        {situation.figure && (
          <p className="mt-0.5 text-2xs font-extrabold uppercase tracking-flat text-ink-3">
            {situation.figure.value} {situation.figure.unit}
          </p>
        )}
      </div>
    </div>
  );
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
  // Issue #400 (slice 4c-b): a gratuitous membership keeps its real,
  // nonzero `monthlyPrice` — the price is no longer zeroed, only flagged
  // (`Membresia.esGratuidadFamiliar`, read by `describePaymentSituation`
  // into `situation.kind === "gratuitous"`). Showing "A pagar $35,00" next
  // to a verdict that already says "no paga" would contradict it, so this
  // row is suppressed for that kind — the verdict above already states the
  // gratuity, in full, as `situation.headline`/`situation.detail`.
  const isGratuitous = situation.kind === "gratuitous";
  const monthlyPriceLabel = monthlyPrice && !isGratuitous ? formatCurrency(monthlyPrice) : null;

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

      <CuotaVerdict situation={situation} />

      {compact ? (
        // One line UNDER the verdict: the date that still matters once there
        // is nothing to resolve, and a quiet way back to the form for a family
        // paying ahead. Still no paragraph and no button — that is what
        // compact means — but the verdict above is not optional any more.
        //
        // It used to read "no button — the carnet's own pill already said 'Al
        // día'", and it leaned on that pill for the whole verdict: the card
        // itself said only "Cubierta hasta 31/12/2026", leaving the reader to
        // infer "al día" from a date in the future. With the pill gone that
        // inference had no source at all, so `CuotaVerdict` above states
        // `situation.headline` — "Está al día con el club" — in every branch.
        //
        // The guard is not defensive noise: with both the date and the action
        // gone the row would be an empty band of padding under the verdict,
        // and `covered` without a `coverageEnd` is unreachable today only
        // because `describePaymentSituation` derives the kind FROM the date.
        (coverageEnd || action) && (
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
          {coverageEnd && (
            <p className="text-sm text-ink-2">
              Cubierta hasta{" "}
              <b className="font-semibold tabular-nums text-ink">{formatDate(coverageEnd)}</b>
            </p>
          )}
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
        )
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
