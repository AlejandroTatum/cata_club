/**
 * Pure utility functions for the Membresías y Pagos admin page.
 *
 * No React dependencies — pure functions for testability. Mirrors the
 * client-side pagination pattern established in members-utils.ts and
 * attendance-utils.ts.
 */

import type { PaymentValidationRequest } from "@/services/api";
import { MONTH_ABBR } from "@/lib/format-utils";

/** Requests per page for the payment validation queue table. */
export const PAYMENTS_PAGE_SIZE = 10;

/**
 * Slice a (possibly already filtered) payment requests list to a single page.
 *
 * `page` is 1-indexed. Returns an empty array when `page` is beyond the
 * available data — never throws or wraps around.
 */
export function paginatePaymentRequests(
  requests: PaymentValidationRequest[],
  page: number,
  pageSize: number = PAYMENTS_PAGE_SIZE,
): PaymentValidationRequest[] {
  const start = (page - 1) * pageSize;
  return requests.slice(start, start + pageSize);
}

/**
 * Total number of pages for a given payment request count.
 *
 * Always returns at least 1 (never 0 pages, even for an empty list) so
 * "Página 1 de 1" is a valid state to render.
 */
export function getTotalPages(
  totalRequests: number,
  pageSize: number = PAYMENTS_PAGE_SIZE,
): number {
  return Math.max(1, Math.ceil(totalRequests / pageSize));
}

// ---------------------------------------------------------------------------
// Humanised period (Fase 3 — prototype 09/10: "1 jul → 12 ago")
// ---------------------------------------------------------------------------

// The month vocabulary lives in `lib/format-utils.ts`, the single source of
// truth for date grammar. This module owns the "1 jul → 12 ago" phrasing only.

/** En dash (formatDateRange's own separator), em dash, or a plain hyphen. */
const PERIOD_SEPARATOR = /\s+[–—-]\s+/;

interface ParsedDay {
  day: number;
  month: number;
  year: number;
}

/**
 * Parse one `dd/mm/yyyy` half of the period string.
 *
 * The period arrives from the BFF as an ALREADY FORMATTED string
 * (`payments-adapter.ts:140` calls `formatDateRange(fechaInicio, fechaFin)`),
 * so there are no raw dates left to work from on the client — re-parsing the
 * rendered value is the only option that does not change the DTO. Rejects
 * impossible days rather than letting them roll over into the next month.
 */
function parseDayMonthYear(value: string): ParsedDay | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value.trim());
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  if (month < 1 || month > 12) return null;
  const date = new Date(year, month - 1, day);
  if (date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return { day, month, year };
}

function renderDay(parsed: ParsedDay, withYear: boolean): string {
  const base = `${parsed.day} ${MONTH_ABBR[parsed.month - 1]}`;
  return withYear ? `${base} ${parsed.year}` : base;
}

/**
 * Humanise the membership period for the queue table: `01/07/2026 – 12/08/2026`
 * becomes `1 jul → 12 ago`.
 *
 * The year is shown only when the period straddles two of them — a mensualidad
 * that starts and ends inside the current year does not need to say so twice.
 * Anything this cannot parse is returned verbatim: a period the reader can
 * still decipher beats an empty cell.
 */
export function humanizePaymentPeriod(period: string): string {
  if (!period) return "";

  const parts = period.split(PERIOD_SEPARATOR);
  if (parts.length === 1) {
    const single = parseDayMonthYear(parts[0]);
    return single ? renderDay(single, false) : period;
  }
  if (parts.length !== 2) return period;

  const start = parseDayMonthYear(parts[0]);
  const end = parseDayMonthYear(parts[1]);
  if (!start || !end) return period;

  const withYear = start.year !== end.year;
  return `${renderDay(start, withYear)} → ${renderDay(end, withYear)}`;
}

// ---------------------------------------------------------------------------
// Pending queue navigation (Fase 3 — "Pendiente 2 de 14", prev/next, auto-advance)
// ---------------------------------------------------------------------------

/** The pending subset, in list order — the queue the admin is actually working. */
export function getPendingRequests(
  requests: PaymentValidationRequest[],
): PaymentValidationRequest[] {
  return requests.filter((r) => r.validationStatus === "pendiente");
}

export interface QueueNeighbours {
  /** 1-based position in the pending queue; 0 when the request is not in it. */
  position: number;
  total: number;
  previousId: string | null;
  nextId: string | null;
}

/**
 * Where a request sits in the pending queue, and what surrounds it.
 *
 * Selecting a request used to replace the whole list, so the admin lost their
 * place with no way back to it. This is the datum that makes the detail view a
 * position in a queue rather than a dead end.
 */
export function findQueueNeighbours(
  pending: PaymentValidationRequest[],
  currentId: string,
): QueueNeighbours {
  const index = pending.findIndex((r) => r.id === currentId);
  if (index === -1) {
    return { position: 0, total: pending.length, previousId: null, nextId: null };
  }
  return {
    position: index + 1,
    total: pending.length,
    previousId: index > 0 ? pending[index - 1].id : null,
    nextId: index < pending.length - 1 ? pending[index + 1].id : null,
  };
}

/**
 * Which request to open after the current one is approved or rejected.
 *
 * Takes the pending queue as it stood BEFORE the decision, because after it the
 * resolved request is no longer in the queue and its neighbours are unfindable.
 * Forward first, then backward, then null — clearing the last item returns the
 * admin to the list rather than to an arbitrary other payment.
 */
export function getAutoAdvanceId(
  pendingBeforeDecision: PaymentValidationRequest[],
  resolvedId: string,
): string | null {
  const { previousId, nextId } = findQueueNeighbours(pendingBeforeDecision, resolvedId);
  return nextId ?? previousId;
}

// ---------------------------------------------------------------------------
// Approval checklist + typified rejection reasons (prototypes 10 and 11)
// ---------------------------------------------------------------------------

export interface ApprovalCheck {
  key: string;
  label: string;
}

/**
 * What kind of payment this is, for checklist purposes.
 *
 * The DTO carries `paymentMethod` as an already-translated LABEL — the backend
 * enum `TipoPago` (`EFECTIVO` | `TRANSFERENCIA`) is mapped to "Efectivo" /
 * "Transferencia" server-side in `lib/server/payments-adapter.ts`
 * (`PAYMENT_METHOD_BY_TIPO_PAGO`), and the label is the only form that reaches
 * the client. So this normalises the label back into a kind rather than
 * inventing a second field on the DTO, and anything it does not recognise
 * falls into `otro`, which is treated as strictly as a transfer.
 */
export type PaymentMethodKind = "efectivo" | "transferencia" | "otro";

export function classifyPaymentMethod(paymentMethod: string): PaymentMethodKind {
  // No accent folding needed: neither word carries a diacritic in any casing
  // the adapter can produce, so lowercasing is the whole normalisation.
  const normalized = paymentMethod.trim().toLowerCase();
  if (normalized.includes("efectivo")) return "efectivo";
  if (normalized.includes("transferencia")) return "transferencia";
  return "otro";
}

export interface ApprovalChecklistContext {
  /** `PaymentValidationRequest.paymentMethod` — the label, verbatim. */
  paymentMethod: string;
  /** Already formatted for display, e.g. "$25,00". */
  expectedAmountLabel: string;
  /** Whether a proof file is actually attached (`proofPreviewUrl`). */
  hasProof: boolean;
}

export interface ApprovalChecklist {
  kind: PaymentMethodKind;
  /** One line under the heading, only when the payment is not the usual case. */
  note?: string;
  items: ApprovalCheck[];
}

/**
 * What the admin must confirm before "Aprobar pago" unlocks — derived from the
 * payment, not fixed.
 *
 * The list used to be the same three transfer questions for every payment, so a
 * cash payment with "Sin comprobante adjunto" still demanded «El comprobante es
 * legible y no está cortado» and «El monto del comprobante coincide con …».
 * Both are unanswerable there, and a safeguard you have to falsify in order to
 * proceed teaches people to tick blindly — which is exactly what destroys the
 * checklist on the transfers where reading the voucher is the whole job.
 *
 * So the questions come from what is actually verifiable: a voucher when there
 * is one to read, the club's account when a transfer arrived without proof, the
 * money in hand when it was cash. The gate itself does not move — every
 * applicable item still has to be ticked.
 */
export function buildApprovalChecklist({
  paymentMethod,
  expectedAmountLabel,
  hasProof,
}: ApprovalChecklistContext): ApprovalChecklist {
  const kind = classifyPaymentMethod(paymentMethod);
  const periodCheck: ApprovalCheck = {
    key: "periodo",
    label: "El período de vigencia que se va a activar es el correcto",
  };

  if (kind === "efectivo") {
    return {
      kind,
      note: hasProof
        ? "Pago en efectivo con recibo adjunto: se confirma la entrega del dinero, no una transferencia."
        : "Pago en efectivo, sin comprobante que revisar: se confirma la entrega del dinero.",
      items: [
        { key: "efectivo-recibido", label: `Se recibió ${expectedAmountLabel} en efectivo` },
        ...(hasProof
          ? [{ key: "legible", label: "El recibo adjunto es legible y no está cortado" }]
          : []),
        periodCheck,
      ],
    };
  }

  // A voucher exists: reading it against the numbers IS the review.
  if (hasProof) {
    return {
      kind,
      items: [
        { key: "legible", label: "El comprobante es legible y no está cortado" },
        { key: "monto", label: `El monto del comprobante coincide con ${expectedAmountLabel}` },
        { key: "fecha", label: "La fecha de la transferencia cae dentro del período" },
      ],
    };
  }

  // A transfer with nothing attached: the club's account statement is the only
  // evidence left, so the checklist says so instead of asking about a file.
  return {
    kind,
    note:
      kind === "transferencia"
        ? "Transferencia sin comprobante adjunto: verifíquela en la cuenta del club antes de aprobar."
        : `Pago registrado como “${paymentMethod}”, sin comprobante adjunto: verifíquelo antes de aprobar.`,
    items: [
      {
        key: "acreditado",
        label:
          kind === "transferencia"
            ? `La transferencia de ${expectedAmountLabel} está acreditada en la cuenta del club`
            : `El pago de ${expectedAmountLabel} está verificado fuera del sistema`,
      },
      periodCheck,
    ],
  };
}

// ---------------------------------------------------------------------------
// Batch approval (P7 — "selección múltiple + validación por lote")
// ---------------------------------------------------------------------------

/**
 * The next pending request still waiting to be reviewed, after `currentId`.
 *
 * Used by "Marcar como revisado", which — unlike approving — leaves the request
 * in the pending queue, so `getAutoAdvanceId` would walk straight back into an
 * item the admin has already been through. Looks forward first, then wraps to
 * the top for anything skipped, and returns null when nothing is left to
 * review, which sends the admin back to the queue to commit the batch.
 */
export function getNextUnreviewedId(
  pending: PaymentValidationRequest[],
  currentId: string,
  reviewedIds: ReadonlySet<string>,
): string | null {
  const index = pending.findIndex((r) => r.id === currentId);
  const start = index === -1 ? 0 : index + 1;
  const order = [...pending.slice(start), ...pending.slice(0, Math.max(start - 1, 0))];
  return order.find((r) => r.id !== currentId && !reviewedIds.has(r.id))?.id ?? null;
}

/**
 * The confirmation sentence for a batch approval: what is about to happen, to
 * how many, and to whom.
 *
 * Names are the point — "¿Aprobar 7 pagos?" is not a decision anyone can make.
 * Long batches are truncated because a dialog nobody reads is the same as no
 * dialog at all.
 */
export function describeBatchApproval(
  studentNames: string[],
  totalLabel: string,
  maxNames = 4,
): string {
  const count = studentNames.length;
  const shown = studentNames.slice(0, maxNames).join(", ");
  const rest = count - Math.min(count, maxNames);
  const names = rest > 0 ? `${shown} y ${rest} más` : shown;
  const head =
    count === 1
      ? `Se va a aprobar 1 pago ya revisado, por ${totalLabel}.`
      : `Se van a aprobar ${count} pagos ya revisados, por un total de ${totalLabel}.`;
  const tail =
    count === 1 ? `Se activa la membresía de ${names}.` : `Se activan las membresías de ${names}.`;
  return `${head} ${tail}`;
}

/** Outcome of a batch run — every item lands in exactly one of the two lists. */
export interface BatchApprovalOutcome {
  approved: string[];
  failed: string[];
}

export interface RejectionReasonOption {
  key: string;
  label: string;
  description?: string;
}

/**
 * The four typified rejection reasons (prototype 11).
 *
 * Free text was the problem: the payer receives the reason word for word and
 * has to act on it, and an admin writing prose at 11pm produces something
 * nobody can act on. The label below is exactly what the payer reads.
 */
export const REJECTION_REASONS: RejectionReasonOption[] = [
  {
    key: "monto",
    label: "El monto no coincide",
    description: "El comprobante muestra un valor distinto al esperado.",
  },
  { key: "ilegible", label: "El comprobante no se lee" },
  { key: "fuera-periodo", label: "La fecha está fuera del período" },
  { key: "duplicado", label: "El comprobante ya fue usado en otro pago" },
];

/**
 * Build the `rejectionReason` string the backend stores and the payer reads.
 *
 * Returns "" for an unselected or unknown reason so the caller can keep the
 * submit blocked — the backend contract still requires a non-empty reason.
 */
export function composeRejectionReason(reasonKey: string, note: string): string {
  const reason = REJECTION_REASONS.find((r) => r.key === reasonKey);
  if (!reason) return "";
  const trimmedNote = note.trim();
  return trimmedNote ? `${reason.label} — ${trimmedNote}` : reason.label;
}
