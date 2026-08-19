/**
 * Pure helpers for the discount catalog screen and the benefit assignment
 * picker (`BeneficioSection`).
 *
 * `computeMontoFinal` — the display preview of a per-payment discount —
 * was removed with the picker itself (issue #398): a discount stopped being
 * a per-payment choice, so there is no longer an amount to preview here. The
 * backend still resolves and freezes the persona's assigned benefit at
 * registration time; it just isn't chosen, or previewed, on this screen
 * anymore.
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
