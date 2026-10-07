/**
 * Tariff periodicity — how often a tariff is paid and how much coverage one
 * payment buys. Mirrors the backend `PeriodicidadTarifa`:
 * - MENSUAL: calendar months (the historical default; the only one that can owe months).
 * - SEMANAL: one payment covers 7 days.
 * - DIARIA: "paga por día suelto" — one payment covers only the paid day.
 */
export type Periodicidad = "MENSUAL" | "SEMANAL" | "DIARIA";

export const PERIODICIDADES: readonly Periodicidad[] = ["MENSUAL", "SEMANAL", "DIARIA"];

/** Short name of each periodicity, for badges and selectors. */
export const PERIODICIDAD_LABEL: Record<Periodicidad, string> = {
  MENSUAL: "Mensual",
  SEMANAL: "Semanal",
  DIARIA: "Diaria",
};

const PERIOD_SUFFIX: Record<Periodicidad, string> = {
  MENSUAL: "al mes",
  SEMANAL: "a la semana",
  DIARIA: "por día",
};

/** An older backend or a hand-built fixture may omit the field: that is MENSUAL. */
export function normalizePeriodicidad(value: unknown): Periodicidad {
  return value === "SEMANAL" || value === "DIARIA" ? value : "MENSUAL";
}

/** «al mes» / «a la semana» / «por día». */
export function periodSuffix(periodicidad: Periodicidad | null | undefined): string {
  return PERIOD_SUFFIX[normalizePeriodicidad(periodicidad)];
}

/** A formatted price with its period: «$ 25,00 al mes», «$ 8,00 a la semana», «$ 3,00 por día». */
export function priceWithPeriod(
  formattedPrice: string,
  periodicidad: Periodicidad | null | undefined,
): string {
  return `${formattedPrice} ${periodSuffix(periodicidad)}`;
}

/** «Valor mensual» / «Valor semanal» / «Valor por día» — the plan-facts label. */
export function priceFactLabel(periodicidad: Periodicidad | null | undefined): string {
  switch (normalizePeriodicidad(periodicidad)) {
    case "SEMANAL":
      return "Valor semanal";
    case "DIARIA":
      return "Valor por día";
    default:
      return "Valor mensual";
  }
}

/** «Tarifa mensual» / «Tarifa semanal» / «Tarifa por día» — the admin's plan-facts label. */
export function tarifaFactLabel(periodicidad: Periodicidad | null | undefined): string {
  switch (normalizePeriodicidad(periodicidad)) {
    case "SEMANAL":
      return "Tarifa semanal";
    case "DIARIA":
      return "Tarifa por día";
    default:
      return "Tarifa mensual";
  }
}

/** SEMANAL/DIARIA never accrue debt: only MENSUAL tariffs owe months. */
export function accruesDebt(periodicidad: Periodicidad | null | undefined): boolean {
  return normalizePeriodicidad(periodicidad) === "MENSUAL";
}

/** Coverage one payment buys: «1 mes», «1 semana (7 días)», «el día pagado». */
export function coverageOfOnePayment(periodicidad: Periodicidad | null | undefined): string {
  switch (normalizePeriodicidad(periodicidad)) {
    case "SEMANAL":
      return "1 semana (7 días)";
    case "DIARIA":
      return "el día pagado";
    default:
      return "1 mes";
  }
}
