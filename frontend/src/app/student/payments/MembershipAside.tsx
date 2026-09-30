"use client";

/** Membership status card for the /student/payments rail. */

import type { MembershipSummary } from "@/services/api";
import { Badge, cn, type BadgeTone } from "@/components/ui";
import { formatCurrency, formatDate } from "@/lib/format-utils";
import { describeMembershipState, describePaymentSituation } from "../student-utils";

/**
 * The status-footer dot's text color, one per `BadgeTone` — the same
 * tone→color pairing `Badge` uses for its own `currentColor` dot, reused
 * here as plain text color since this dot sits alone, with no pill behind
 * it.
 */
export const STATUS_DOT_TEXT: Record<BadgeTone, string> = {
  neutral: "text-state-neutral",
  ok: "text-state-ok",
  warn: "text-state-warn",
  bad: "text-state-bad",
};

// ---------------------------------------------------------------------------
// Membership status — everything the club can actually prove about coverage
// ---------------------------------------------------------------------------

export function MembershipCard({
  membership,
  coverageEnd,
  /**
   * Whose membership this is, when the reader is not that person.
   *
   * A guardian with exactly ONE dependent never saw the switcher (it hides
   * below two profiles), so this whole screen — titled "Mis pagos", with a
   * card reading "Su membresía" and a form that debits a specific persona —
   * never once named the student it was about. Laura Vera, who has no
   * membership of her own, was registering a payment for Sofía on a page that
   * said "su".
   */
  studentName,
  approvedCount,
  children,
}: {
  membership: MembershipSummary | null;
  coverageEnd: string | null;
  studentName: string | null;
  /** Approved payments in the history below; shown as a fact when there are any. */
  approvedCount?: number;
  children?: React.ReactNode;
}): React.ReactElement {
  // Issue #815: `coverageEnd` — `MembershipSummary.cubiertoHasta` (issue
  // #1328), the very date the heading below prints — is passed in, so the badge and
  // that heading can no longer tell the reader two different things. Reading
  // `estado` alone let this badge say "Membresía activa" over a coverage date
  // that had already passed, every night until the 02:35 batch caught up.
  // `today` is left at its default (hence the explicit `undefined`) for the
  // same reason `describePaymentSituation` is called without one further down
  // this file: one clock per screen.
  //
  // The membership goes in whole because gratuity outranks that coverage
  // reading — `esGratuidadFamiliar` is checked before the dates on both sides
  // of this card, so the badge cannot report a lapse over the very paragraph
  // this card renders below it ("esta membresía no genera ningún cobro").
  const state = describeMembershipState(membership?.estado, coverageEnd, undefined, membership ?? {});

  const facts: { label: string; value: string }[] = [];
  if (membership?.categoria) facts.push({ label: "Plan", value: membership.categoria });
  // Issue #400 (slice 4c-b): `montoAplicado` stays the real, nonzero tariff
  // even for a gratuitous membership (`esGratuidadFamiliar`) — E04-RF002
  // stopped zeroing it. Printing "Valor mensual: $35,00" here would read as
  // an amount this family owes, when this specific membership charges $0
  // regardless. The gratuity itself is stated by the form area below
  // (`RenewPaymentForm` is replaced by an explanatory paragraph for this
  // case), not by this facts row.
  if (membership?.montoAplicado && !membership.esGratuidadFamiliar) {
    facts.push({ label: "Valor mensual", value: formatCurrency(membership.montoAplicado) });
  }
  // Both already loaded: they sit beside the heading so the card's right side
  // carries the membership's facts instead of staying blank on a wide screen.
  if (membership?.fechaActivacion) {
    facts.push({ label: "Socio desde", value: formatDate(membership.fechaActivacion) });
  }
  if (approvedCount) facts.push({ label: "Pagos aprobados", value: String(approvedCount) });

  return (
    <section
      data-testid="membership-status"
      className="card overflow-hidden"
      aria-labelledby="membership-status-title"
    >
      {/* The badge carries the `estado`; the heading carries the fact the
          reader came for. The badge used to say the same thing as the heading
          in coarser words ("Al día"), which is a second, weaker judgement of
          data that already speaks for itself. */}
      <div className="flex flex-wrap items-center justify-between gap-x-10 gap-y-section px-5 py-[18px]">
        <div className="min-w-0 flex-1 basis-72 sm:flex-none sm:basis-[26rem]">
          <div className="mb-2 flex flex-wrap items-center gap-2.5">
            <p className="text-2xs font-bold uppercase text-ink-3">
              {studentName ? `Membresía de ${studentName}` : "Su membresía"}
            </p>
            <Badge tone={state.tone}>{state.label}</Badge>
          </div>
          <h2 id="membership-status-title" className="text-base font-bold tracking-tight text-ink">
            {coverageEnd ? (
              <>
                Pagado hasta el <span className="tabular-nums">{formatDate(coverageEnd)}</span>
              </>
            ) : (
              "Todavía no hay ningún pago aprobado"
            )}
          </h2>
          <p className="mt-1.5 text-sm text-ink-3">
            {coverageEnd
              ? "Es la fecha del pago aprobado que llega más lejos en su historial."
              : "En cuanto el club apruebe un pago, aquí aparecerá hasta qué fecha queda cubierto."}
          </p>
        </div>

        {facts.length > 0 && (
          <dl className="flex min-w-[16rem] flex-1 flex-wrap justify-evenly gap-x-8 gap-y-section">
            {facts.map((fact) => (
              <div key={fact.label}>
                <dt className="text-2xs font-bold uppercase text-ink-3-strong">{fact.label}</dt>
                <dd className="mt-1 text-base font-bold tabular-nums text-ink">{fact.value}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>

      {/* Issue #513 (Propuesta B, idea 1): a compact status-footer dot, in the
          same row as the CTA below — the `Badge` at the top carries the state
          for a reader scanning down from the title; this repeats it right
          where the eye lands before acting, so status and action read
          together without a scroll back up. One row rather than two: a thin
          footer line above a button left a blank band to the right of both. */}
      {children && (
        <div className="flex flex-col gap-x-6 gap-y-section border-t border-line px-5 py-3.5 sm:flex-row sm:items-start">
          <span className="flex h-ctl flex-none items-center gap-1.5 sm:w-44">
            <span aria-hidden="true" className={cn("h-1.5 w-1.5 flex-none rounded-full bg-current", STATUS_DOT_TEXT[state.tone])} />
            <span className={cn("text-2xs font-bold uppercase", STATUS_DOT_TEXT[state.tone])}>{state.label}</span>
          </span>
          <div className="min-w-0 flex-1 self-center">{children}</div>
        </div>
      )}
    </section>
  );
}
