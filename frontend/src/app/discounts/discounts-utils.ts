/**
 * Pure helpers for the discount catalog screen and the payment-form preview.
 *
 * `computeMontoFinal` is a DISPLAY mirror of the backend's arithmetic
 * (`PagoServicio.registrar_pago`): each percentage applies over the BASE
 * amount and fixed amounts subtract directly. The backend remains the
 * authority — it resolves the current catalog values, freezes them and
 * computes the real final amount at registration; this preview only lets the
 * admin see the resulting amount before submitting. No validation lives here
 * (cap >100%, inactive discounts): those backend 400s surface as form errors.
 */

import type { DescuentoCatalogo } from "@/services/api";
import { formatCurrency } from "@/lib/format-utils";

/** Only active discounts are offered for application; the full catalog
 *  (inactive included) is the admin management view at /discounts. */
export function descuentosActivos(catalogo: DescuentoCatalogo[]): DescuentoCatalogo[] {
  return catalogo.filter((descuento) => descuento.activo);
}

/** Human label of the discount's value: "50%" or "$10,00". */
export function descuentoValorLabel(descuento: DescuentoCatalogo): string {
  if (descuento.porcentaje !== null) {
    return `${Number(descuento.porcentaje)}%`;
  }
  return formatCurrency(descuento.monto);
}

/**
 * Final amount after applying the selected discounts over `montoBase`.
 * Percentages apply over the base (not compounded), fixed amounts subtract
 * directly; the result is clamped at 0 and rounded to 2 decimals.
 */
export function computeMontoFinal(
  montoBase: number,
  seleccionados: Pick<DescuentoCatalogo, "porcentaje" | "monto">[],
): number {
  const descontado = seleccionados.reduce((total, descuento) => {
    if (descuento.porcentaje !== null) {
      return total + (montoBase * Number(descuento.porcentaje)) / 100;
    }
    return total + Number(descuento.monto ?? 0);
  }, 0);
  const final = Math.max(0, montoBase - descontado);
  return Math.round(final * 100) / 100;
}
