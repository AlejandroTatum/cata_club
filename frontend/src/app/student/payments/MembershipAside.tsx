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
  const playerSince = membership?.socioDesde ?? membership?.fechaActivacion;
  if (playerSince) {
    facts.push({ label: "Jugador desde", value: formatDate(playerSince) });
  }
  if (approvedCount) facts.push({ label: "Pagos aprobados", value: String(approvedCount) });

  return (
    <section
      data-testid="membership-status"
      className="card overflow-hidden"
      aria-labelledby="membership-status-title"
    >
      {/* Rail card: identity and coverage on top, the plan facts as a compact
          two-column grid, then the action area. Stacked because the rail is
          340px wide; the badge carries the `estado`, the heading carries the
          fact the reader came for. */}
      <div className="px-5 py-[18px]">
        <div className="mb-2 flex flex-wrap items-center gap-2.5">
          <p className="text-2xs font-bold uppercase text-ink-3-strong">
            {studentName ? `Membresía de ${studentName}` : "Tu membresía"}
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
        <p className="mt-1.5 text-sm text-ink-3-strong">
          {coverageEnd
            ? state.tone === "bad"
              ? "Tu cobertura terminó en esta fecha, según tus pagos aprobados."
              : "Tu membresía está cubierta hasta esta fecha según tus pagos aprobados."
            : "En cuanto el club apruebe un pago, aquí aparecerá hasta qué fecha queda cubierto."}
        </p>

        {membership?.estado === "SUSPENDIDA" && (
          <p
            data-testid="suspension-reason"
            className="mt-3 rounded-ctl bg-state-warn-bg px-3 py-2 text-sm text-ink"
          >
            <span className="font-bold">Motivo de la suspensión: </span>
            {membership.motivoSuspension ?? "El club no registró un motivo. Consulta con administración."}
          </p>
        )}

        {facts.length > 0 && (
          <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-line pt-4">
            {facts.map((fact) => (
              <div key={fact.label} className="min-w-0">
                <dt className="text-2xs font-bold uppercase text-ink-3-strong">{fact.label}</dt>
                <dd className="mt-0.5 truncate text-sm font-bold tabular-nums text-ink">{fact.value}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>

      {children && (
        <div className="flex flex-col gap-3 border-t border-line bg-sunken/40 px-5 py-4">
          <span className="flex items-center gap-1.5">
            <span aria-hidden="true" className={cn("h-1.5 w-1.5 flex-none rounded-full bg-current", STATUS_DOT_TEXT[state.tone])} />
            <span className={cn("text-2xs font-bold uppercase", STATUS_DOT_TEXT[state.tone])}>{state.label}</span>
          </span>
          <div className="min-w-0">{children}</div>
        </div>
      )}
    </section>
  );
}
