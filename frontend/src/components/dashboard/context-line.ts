/**
 * The header context line every role dashboard shares: "Administración ·
 * martes, 29 de septiembre de 2026".
 *
 * The date is read in the club's zone (`clubToday`), never the device's, and
 * spelled from tables instead of `Intl` so the output does not change with the
 * ICU build the runner ships.
 */

import { DIA_SEMANA_LABELS } from "@/app/attendance/attendance-utils";
import { clubToday, todayDiaSemana } from "@/lib/club-date";

const MONTH_NAMES = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
] as const;

/** "martes, 29 de septiembre de 2026" for the club's current day. */
export function formatClubLongDate(now: Date = new Date()): string {
  const today = clubToday(now);
  const weekday = DIA_SEMANA_LABELS[todayDiaSemana(now)].toLocaleLowerCase("es");
  return `${weekday}, ${today.getDate()} de ${MONTH_NAMES[today.getMonth()]} de ${today.getFullYear()}`;
}

/** "<role label> · <long date>" — the subtitle under the greeting. */
export function buildContextLine(roleLabel: string, now: Date = new Date()): string {
  return `${roleLabel} · ${formatClubLongDate(now)}`;
}
