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
 * The three things the admin must confirm before "Aprobar" unlocks.
 *
 * The old list was static prose in an amber box: four sentences the admin had
 * to hold in memory while looking at the proof in the other column, with
 * nothing stopping an approval that skipped all of them. These are real
 * checkboxes and they gate the button (prototype 10).
 */
export function buildApprovalChecklist(expectedAmountLabel: string): ApprovalCheck[] {
  return [
    { key: "legible", label: "El comprobante es legible y no está cortado" },
    { key: "monto", label: `El monto del comprobante coincide con ${expectedAmountLabel}` },
    { key: "fecha", label: "La fecha de la transferencia cae dentro del período" },
  ];
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
