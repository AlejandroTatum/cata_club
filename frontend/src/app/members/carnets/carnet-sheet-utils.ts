import { formatMonthYear } from "@/lib/format-utils";
import type { CarnetSummary } from "@/services/api";
import type { MemberAccount } from "../members-utils";

/**
 * Pure helpers for the admin's carnet printing (issue #1670) — no React.
 */

/**
 * Cards per A4 sheet: the owner's standard 85,6×54mm card, three across and
 * three down, with crop marks. The geometry lives in `globals.css`
 * (`.carnet-sheet`); this is the count it holds.
 */
export const CARDS_PER_SHEET = 9;

/** Same ceiling as `GET /api/carnets`. */
export const MAX_CARNETS = 60;

/**
 * The personas named by `?ids=1,2,3`: positive integers, deduplicated, in the
 * order given. Anything malformed is dropped rather than guessed at.
 */
export function parseCarnetIds(raw: string | null): number[] {
  if (!raw) return [];
  const ids = raw
    .split(",")
    .map((part) => part.trim())
    .filter((part) => /^\d+$/.test(part))
    .map(Number)
    .filter((id) => Number.isSafeInteger(id) && id > 0);
  return [...new Set(ids)].slice(0, MAX_CARNETS);
}

/** The cards split into sheets of `CARDS_PER_SHEET`, the last one possibly short. */
export function chunkIntoSheets<T>(items: readonly T[], perSheet: number = CARDS_PER_SHEET): T[][] {
  const sheets: T[][] = [];
  for (let index = 0; index < items.length; index += perSheet) {
    sheets.push(items.slice(index, index + perSheet));
  }
  return sheets;
}

/** "9 carnets · 1 hoja A4" */
export function describeSheets(count: number): string {
  const sheets = Math.ceil(count / CARDS_PER_SHEET);
  return `${count} ${count === 1 ? "carnet" : "carnets"} · ${sheets} ${sheets === 1 ? "hoja" : "hojas"} A4`;
}

/**
 * The carnets with one player's «Miembro desde» replaced (issue #1749), so a
 * saved edit shows on the card on screen. Every other carnet is the same object.
 */
export function withMiembroDesde(
  carnets: readonly CarnetSummary[],
  id: string,
  miembroDesde: string | null,
): CarnetSummary[] {
  return carnets.map((carnet) =>
    carnet.profile.personaId === id ? { ...carnet, profile: { ...carnet.profile, miembroDesde } } : carnet,
  );
}

/** The account list with one player's «Miembro desde» replaced (issue #1749); every other account is the same object. */
export function withAccountMiembroDesde(
  accounts: readonly MemberAccount[],
  id: string,
  miembroDesde: string | null,
): MemberAccount[] {
  return accounts.map((account) => (account.id === id ? { ...account, miembroDesde } : account));
}

/** What a picker row says about the date on record: «Miembro desde mar 2019» or «Sin fecha». */
export function describeMiembroDesde(miembroDesde: string | null | undefined): string {
  const label = miembroDesde ? formatMonthYear(miembroDesde) : "";
  return label ? `Miembro desde ${label}` : "Sin fecha";
}

/** Whether at least one carnet in the batch has no «Miembro desde» — the case the batch block opens for. */
export function hasUndatedPlayer(carnets: readonly CarnetSummary[]): boolean {
  return carnets.some((carnet) => !carnet.profile.miembroDesde);
}
