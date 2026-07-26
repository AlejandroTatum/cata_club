/**
 * Pure utility functions for the Student payments page.
 *
 * Extracted for testability — no React dependencies. Same pattern as
 * attendance-utils.ts / members-utils.ts.
 */

import type { PagoPersona } from "@/services/api";
import type { BadgeTone } from "@/components/ui/Badge";
import { formatCurrency } from "@/lib/format-utils";

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

export type PagoStatusFilter = "TODOS" | "PENDIENTE_VALIDACION" | "APROBADO" | "RECHAZADO";

export const PAGO_FILTER_LABELS: Record<PagoStatusFilter, string> = {
  TODOS: "Todos",
  PENDIENTE_VALIDACION: "Pendientes",
  APROBADO: "Aprobados",
  RECHAZADO: "Rechazados",
};

/**
 * Filter a payment list by status. "TODOS" returns the full list.
 */
export function filterPagosByStatus(
  pagos: PagoPersona[],
  filter: PagoStatusFilter,
): PagoPersona[] {
  if (filter === "TODOS") return pagos;
  return pagos.filter((p) => p.estadoPago === filter);
}

// ---------------------------------------------------------------------------
// Sorting
// ---------------------------------------------------------------------------

/**
 * Sort payments newest-first by `fechaRegistro`.
 */
export function sortPagosByDate(pagos: PagoPersona[]): PagoPersona[] {
  return [...pagos].sort(
    (a, b) => new Date(b.fechaRegistro).getTime() - new Date(a.fechaRegistro).getTime(),
  );
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/** Human-readable payment method label. */
export const TIPO_PAGO_LABEL: Record<PagoPersona["tipoPago"], string> = {
  EFECTIVO: "Efectivo",
  TRANSFERENCIA: "Transferencia",
};

/**
 * The one reading of a `Pago.estadoPago` — label plus `Badge` tone.
 *
 * `PENDIENTE_VALIDACION` is `warn`, never `bad`: waiting for the club to check
 * a voucher is the normal path through this screen, and the previous amber pill
 * sat one shade away from the red rejection pill. Only a real rejection is
 * `bad`, because it is the only state that asks the family to do something.
 */
export function describePagoEstado(
  estado: PagoPersona["estadoPago"],
): { label: string; tone: BadgeTone } {
  if (estado === "APROBADO") return { label: "Aprobado", tone: "ok" };
  if (estado === "RECHAZADO") return { label: "Rechazado", tone: "bad" };
  return { label: "Pendiente de validación", tone: "warn" };
}

// ---------------------------------------------------------------------------
// Coverage period
// ---------------------------------------------------------------------------

/**
 * How many whole months an amount buys at a plan's monthly price, or `null`
 * when it is not a whole multiple of it.
 *
 * The old renewal form divided and fed the quotient straight into
 * `Date.prototype.setMonth`, which truncates a fraction — so $37,50 against a
 * $25 plan drew "1 mes de vigencia" on screen while the amount being submitted
 * said something else entirely.
 *
 * The rounding tolerance is not decoration: `40.8 / 13.6` is
 * 2.9999999999999996 in binary floating point, and a strict `% !== 0` check
 * rejects a payment of exactly three months.
 */
export function wholeMonthsFor(amount: number, monthlyPrice: number): number | null {
  if (!Number.isFinite(amount) || !Number.isFinite(monthlyPrice)) return null;
  if (monthlyPrice <= 0 || amount <= 0) return null;
  const months = amount / monthlyPrice;
  const rounded = Math.round(months);
  if (rounded < 1 || Math.abs(months - rounded) > 0.001) return null;
  return rounded;
}

/**
 * Add whole months to an ISO `YYYY-MM-DD` date, clamping to the last day of
 * the target month.
 *
 * `new Date("2026-08-31").setMonth(+1)` is 1 October, because 31 September
 * does not exist and JavaScript rolls it forward. A renewal starting the day
 * the previous period ends therefore landed a day into the month AFTER the one
 * the family paid for — small, free to the club, and wrong on the receipt.
 *
 * Anchored at local noon for the same reason `format-utils` is: parsing
 * `YYYY-MM-DD` as UTC midnight shifts to the previous day in Ecuador.
 */
export function addMonthsIso(isoDate: string, months: number): string {
  const start = new Date(`${isoDate}T12:00:00`);
  if (Number.isNaN(start.getTime())) return "";

  const day = start.getDate();
  const target = new Date(start.getTime());
  target.setDate(1);
  target.setMonth(target.getMonth() + months);

  const lastDayOfTargetMonth = new Date(
    target.getFullYear(),
    target.getMonth() + 1,
    0,
    12,
  ).getDate();
  target.setDate(Math.min(day, lastDayOfTargetMonth));

  const mm = String(target.getMonth() + 1).padStart(2, "0");
  const dd = String(target.getDate()).padStart(2, "0");
  return `${target.getFullYear()}-${mm}-${dd}`;
}

// ---------------------------------------------------------------------------
// Counts
// ---------------------------------------------------------------------------

/** How many payments fall in each filter bucket — one pass, so the pills cannot disagree with the list. */
export function countPagosByStatus(pagos: PagoPersona[]): Record<PagoStatusFilter, number> {
  return {
    TODOS: pagos.length,
    PENDIENTE_VALIDACION: pagos.filter((p) => p.estadoPago === "PENDIENTE_VALIDACION").length,
    APROBADO: pagos.filter((p) => p.estadoPago === "APROBADO").length,
    RECHAZADO: pagos.filter((p) => p.estadoPago === "RECHAZADO").length,
  };
}

/**
 * Format a payment amount for display.
 *
 * Delegates to `formatCurrency`, the product's one currency grammar. The old
 * `` `$${monto}` `` template printed the backend string verbatim (`$35.00`)
 * and was exactly the second format `src/lib/format-utils.ts` exists to
 * remove — the same $25 membership read `$25,00` on the carnet and `$25.00`
 * one screen away.
 */
export function formatPagoMonto(monto: string): string {
  return formatCurrency(monto);
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

/**
 * Contextual message for the empty-state card depending on the active filter.
 */
export function getEmptyStateMessage(filter: PagoStatusFilter): string {
  switch (filter) {
    case "TODOS":
      return "Todavía no hay pagos registrados.";
    case "APROBADO":
      return "No hay pagos aprobados.";
    case "RECHAZADO":
      return "No hay pagos rechazados.";
    case "PENDIENTE_VALIDACION":
      return "No hay pagos pendientes de validación.";
  }
}
