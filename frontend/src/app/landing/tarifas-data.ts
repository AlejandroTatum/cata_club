/**
 * The landing's price vocabulary, with the mapper that produces it — LAN-03.
 *
 * Prices are managed inside the app (`Tarifas`) and published through the
 * public `GET /api/membresias/tarifas` (`categoria` + `precio` only). Like the
 * schedules (#789), this module holds no price of its own: a copy here is one
 * the club cannot edit and that goes stale in silence.
 */

import { normalizePeriodicidad, periodSuffix, type Periodicidad } from "@/lib/tarifa-periodo";

/** One published plan, ready to render. */
export interface LandingTarifa {
  name: string;
  /** Formatted for the page, e.g. "$25,00". */
  price: string;
  /** «a la semana» / «por día» for the non-monthly plans; absent for monthly ones (the section is «Mensualidad»). */
  period?: string;
}

const DECIMAL_PRICE = /^\d+(?:\.\d{1,2})?$/;

/** "25.00" → "$25,00"; null when the value is not a plain non-negative decimal. */
export function formatTarifaPrice(precio: unknown): string | null {
  const value = typeof precio === "number" ? String(precio) : precio;
  if (typeof value !== "string" || !DECIMAL_PRICE.test(value.trim())) return null;
  const [whole, cents = ""] = value.trim().split(".");
  return `$${whole},${cents.padEnd(2, "0")}`;
}

/** Drops any entry that is not a named plan with a readable price. */
export function mapPublicTarifas(payload: unknown): LandingTarifa[] {
  if (!Array.isArray(payload)) return [];
  return payload.flatMap((entry): LandingTarifa[] => {
    if (typeof entry !== "object" || entry === null) return [];
    const { categoria, precio, periodicidad } = entry as {
      categoria?: unknown;
      precio?: unknown;
      periodicidad?: unknown;
    };
    if (typeof categoria !== "string" || !categoria.trim()) return [];
    const price = formatTarifaPrice(precio);
    if (price === null) return [];
    const period = normalizePeriodicidad(periodicidad) === "MENSUAL" ? undefined : periodSuffix(periodicidad as Periodicidad);
    return [{ name: categoria.trim(), price, ...(period ? { period } : {}) }];
  });
}
