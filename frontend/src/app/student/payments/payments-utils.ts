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

/**
 * A transfer payment still awaiting validation with no voucher attached —
 * the state a failed `subirVoucherPago()` leaves behind after `registrarPago()`
 * already succeeded (PAG-1). The owner's decision is that this payment is
 * NOT reverted: it survives in the history marked this way, with its own way
 * to attach the voucher (`decisiones-de-negocio-2026-08-11.md` §7).
 *
 * Scoped narrowly: EFECTIVO never needs a voucher, and APROBADO/RECHAZADO
 * already carry their own resolution — only a payment genuinely stuck
 * without one, mid-validation, gets the mark.
 */
export function pagoFaltaComprobante(pago: PagoPersona): boolean {
  return (
    pago.tipoPago === "TRANSFERENCIA" &&
    pago.estadoPago === "PENDIENTE_VALIDACION" &&
    !pago.voucherUrl
  );
}

// ---------------------------------------------------------------------------
// Coverage period
// ---------------------------------------------------------------------------

/**
 * Cents in a currency amount, rounded to the nearest integer.
 *
 * `40.8 * 100` is `4079.999999999999` in binary floating point — a plain
 * `amount * 100` would floor away from the true value. Rounding to the
 * nearest cent removes that noise while still catching a genuinely
 * non-multiple amount, because real payment amounts never carry a fraction
 * of a cent.
 */
function toCents(amount: number): number {
  return Math.round(amount * 100);
}

/**
 * How many whole months an amount buys at a plan's monthly price, or `null`
 * when it is not a whole multiple of it.
 *
 * The old renewal form divided and fed the quotient straight into
 * `Date.prototype.setMonth`, which truncates a fraction — so $37,50 against a
 * $25 plan drew "1 mes de vigencia" on screen while the amount being submitted
 * said something else entirely.
 *
 * This used to round the *quotient* with a 0.001 tolerance to survive binary
 * floating point (`40.8 / 13.6` is `2.9999999999999996`). That tolerance was
 * too wide: $49,99 against a $25 quota is 1.9996 months, inside the 0.001
 * band of 2 — the preview promised "2 meses" and the confirmation checkpoint,
 * but the backend's exact `Decimal` modulo
 * (`membresia_pago_servicio.py:308`, "la regla del múltiplo exacto SE QUEDA")
 * then rejected it. The two sides have to agree on the same rule, not two
 * different ones that happen to overlap most of the time.
 *
 * The fix compares in integer cents instead of dividing floats: the backend
 * is exact because `Decimal` has no binary-fraction error, and comparing
 * whole cents (`amountCents % priceCents === 0`) gets the client the same
 * exactness without adopting `Decimal` client-side. `40.8 / 13.6` still
 * resolves to 3 months this way, because `4080 % 1360 === 0` — the floating
 * point noise from `* 100` is well under the 0.5-cent rounding margin, while
 * $49,99 (`4999 % 2500 = 499`) is correctly rejected.
 */
export function wholeMonthsFor(amount: number, monthlyPrice: number): number | null {
  if (!Number.isFinite(amount) || !Number.isFinite(monthlyPrice)) return null;
  if (monthlyPrice <= 0 || amount <= 0) return null;

  const amountCents = toCents(amount);
  const priceCents = toCents(monthlyPrice);
  if (priceCents <= 0) return null;

  // Beyond safe-integer cents, `%` on the rounded values can no longer be
  // trusted to reflect the real amount — reject rather than risk a false
  // "yes" the backend would then contradict.
  if (!Number.isSafeInteger(amountCents) || !Number.isSafeInteger(priceCents)) return null;

  if (amountCents % priceCents !== 0) return null;
  const months = amountCents / priceCents;
  return months >= 1 ? months : null;
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
// Total estimado antes de confirmar (issue #400, slice 06)
// ---------------------------------------------------------------------------

/**
 * The total the checkpoint shows BEFORE the reader confirms — a client-side
 * PREVIEW only, never sent to the backend as authoritative (it still only
 * receives `meses`; the backend resolves the real total itself, applying
 * whatever benefit is active at that exact moment). The real, final amount
 * is `PagoPersona.monto` from the `registrarPago` response, shown after
 * registration in the checkpoint's success toast and in the history.
 *
 * Only a PERCENTAGE benefit is factored in here (`beneficioPorcentaje`) — a
 * fixed-amount (`monto`) discount is a second modality the catalog supports
 * (see `DescuentoCatalogo`) that this preview does not attempt to reproduce
 * client-side; the estimate simply falls back to the undiscounted sticker
 * price in that case, same as when there is no active benefit at all.
 *
 * Rounded to the cent (`Math.round(... * 100) / 100`) so the display never
 * shows a fraction of a cent — this is a preview, not the exact `Decimal`
 * arithmetic `wholeMonthsFor`'s docstring cares about, so plain floating
 * point rounded at the end is precise enough for what the reader compares
 * it against (the real total, shown separately, after registering).
 */
export function estimateTotal(
  monthlyPrice: number,
  months: number,
  beneficioPorcentaje: number | null,
): number {
  if (!Number.isFinite(monthlyPrice) || monthlyPrice <= 0) return 0;
  if (!Number.isFinite(months) || months <= 0) return 0;

  const sticker = monthlyPrice * months;
  if (beneficioPorcentaje == null || !Number.isFinite(beneficioPorcentaje)) return sticker;

  const factor = Math.min(1, Math.max(0, 1 - beneficioPorcentaje / 100));
  return Math.round(sticker * factor * 100) / 100;
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
// El descuento que el club ya aplicó
// ---------------------------------------------------------------------------

/** Los tres números de un pago con descuento, ya formateados. */
export interface PagoDescuento {
  /** Lo que el pago habría costado sin el descuento. */
  precioLista: string;
  /** Lo que el club rebajó, sin signo — quien lo muestra decide cómo escribirlo. */
  descuento: string;
  /** `"50%"` cuando la rebaja era porcentual; `null` si era de monto fijo. */
  porcentaje: string | null;
  /** Lo que efectivamente se paga: `PagoPersona.monto` tal cual. */
  montoFinal: string;
}

/**
 * Lee el descuento congelado de un pago, o `null` si no llevó ninguno.
 *
 * El socio NO elige descuentos: aplicarlos es potestad exclusiva del
 * administrador (issue #11 §4). Esto es la otra mitad de esa decisión —
 * poder LEER el que el club ya le aplicó. Sin esto el historial le mostraba
 * el monto final solo, que es justamente el reclamo que llegó de QA el
 * 17/08/2026 ("no se me muestra el apartado de descuentos").
 *
 * `null` cuando no hubo descuento, y no un objeto en cero: la pantalla no
 * escribe "Descuento: $0,00" para un pago que nunca lo tuvo, y el backend ya
 * distingue los dos casos (`descuento_valor_aplicado` queda NULL, nunca 0 —
 * lo garantiza `ck_pago_descuento_valor_congelado`).
 *
 * ## Por qué el precio de lista se calcula acá
 *
 * No viaja como campo: `Pago.monto` ES el monto final (`registrar_pago` hace
 * `pago.monto = monto_final`) y el base no se persiste. Pero se reconstruye
 * EXACTO, porque `_congelar_descuento` devuelve `monto_base - valor` y nada
 * más toca esas dos columnas después.
 *
 * La suma va en centavos enteros por la misma razón que `wholeMonthsFor`
 * compara en centavos: `Number("26.10") + Number("3.90")` es aritmética
 * binaria sobre fracciones decimales, y el precio de lista es un número que
 * el socio compara contra lo que le dijeron en administración. Un centavo de
 * ruido acá es una discusión en el mostrador.
 */
export function describePagoDescuento(pago: PagoPersona): PagoDescuento | null {
  if (pago.descuentoValorAplicado == null) return null;

  const valor = Number(pago.descuentoValorAplicado);
  const montoFinal = Number(pago.monto);
  if (!Number.isFinite(valor) || !Number.isFinite(montoFinal)) return null;

  const precioListaCents = toCents(montoFinal) + toCents(valor);
  if (!Number.isSafeInteger(precioListaCents)) return null;

  const porcentaje = pago.descuentoPorcentajeAplicado;
  const porcentajeNumero = porcentaje == null ? null : Number(porcentaje);

  return {
    precioLista: formatCurrency(precioListaCents / 100),
    descuento: formatCurrency(valor),
    // `Number` de paso: el backend manda "50.00" y en pantalla eso es "50%".
    // Misma gramática que `descuentoValorLabel` del catálogo de admin.
    porcentaje:
      porcentajeNumero != null && Number.isFinite(porcentajeNumero)
        ? `${porcentajeNumero}%`
        : null,
    montoFinal: formatCurrency(montoFinal),
  };
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
