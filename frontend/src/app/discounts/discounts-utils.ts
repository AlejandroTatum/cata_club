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

/**
 * Client-side mirror of the backend gate in `BeneficioServicio.asignar`
 * (`beneficio_servicio.py`, issue #665): whether this discount, applied
 * against `tarifaMensual`, would exceed it. Strict `>` — a discount that
 * equals 100% of the tarifa (a full scholarship) is valid.
 *
 * A percentage discount can never trip this: the catalog schema caps
 * `porcentaje` at 100 (`DescuentoCreateDTO.porcentaje`, `le=100`), so its
 * computed value is always `<= tarifaMensual`. Only a fixed `monto` can
 * exceed it. This is a pre-submit UX hint only — the backend remains the
 * source of truth and re-validates on assign.
 */
export function descuentoExcedeTarifa(descuento: DescuentoCatalogo, tarifaMensual: number): boolean {
  const valor =
    descuento.porcentaje !== null
      ? (tarifaMensual * Number(descuento.porcentaje)) / 100
      : Number(descuento.monto);
  return valor > tarifaMensual;
}
