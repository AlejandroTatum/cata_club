/**
 * Shared formatting utilities — the single source of truth for how a date
 * and how an amount are rendered anywhere in the product.
 *
 * The UX audit (25 jul) scored Consistency 1/4 and named format multiplicity
 * as the central finding: three date formats and two currency formats meant an
 * admin cross-checking `/payments` against `/reports` was normalising values by
 * hand. On an Operate surface format IS meaning, so there is exactly one date
 * grammar (`dd/mm/yyyy`, per `docs/archive/prototypes/plan-implementacion-rediseno.md:24`) and
 * exactly one currency grammar (`$24,00`, es-EC).
 *
 * Do not hand-roll `toLocaleDateString`, `.toFixed(2)` or a `$${amount}`
 * template at a call site. Import from here — that is the whole point.
 */

/**
 * Parse a date string, handling date-only values ("YYYY-MM-DD") as stable
 * calendar dates instead of UTC midnight.
 *
 * Date-only strings like "2014-03-15" passed to `new Date("2014-03-15")`
 * are interpreted as UTC midnight, which becomes the previous day at
 * 19:00 in America/Guayaquil (UTC-5). Anchoring at noon UTC preserves the
 * intended calendar date across local machines and CI runners.
 *
 * This behaviour is load-bearing: without it a payment dated today displays
 * as yesterday for every user in Ecuador. Do not "simplify" it away.
 *
 * Returns `null` for invalid or empty inputs.
 */
function parseDateStringLocal(dateStr: string): Date | null {
  if (!dateStr) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]) - 1; // 0-indexed
    const day = Number(match[3]);
    const d = new Date(Date.UTC(year, month, day, 12, 0, 0));
    // Reject overflow (month 13 → Jan, day 32 → Feb 1, etc.)
    if (d.getUTCMonth() !== month || d.getUTCDate() !== day) return null;
    return d;
  }
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? null : d;
}

/** Zero-pad to two digits. */
function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * Abbreviated Spanish month names, lowercase and unaccented.
 *
 * The one place this vocabulary is declared. Two screens humanise dates in
 * their own way — attendance renders "Hoy, 23 jul", payments renders
 * "1 jul → 12 ago" — but they must not each carry their own month table, which
 * is how a fourth date grammar gets introduced by a typo. The humanising
 * functions stay where they are; the vocabulary lives here.
 *
 * Indexed 0-11 to match `Date.prototype.getMonth()`.
 */
export const MONTH_ABBR = [
  "ene", "feb", "mar", "abr", "may", "jun",
  "jul", "ago", "sep", "oct", "nov", "dic",
] as const;

/**
 * Format a numeric amount as USD currency per Ecuadorian locale (`$24,00`).
 *
 * Normalizes ICU-version-dependent whitespace/literal parts by assembling
 * via `formatToParts`. Returns `"$0,00"` for non-finite, NaN or absent inputs.
 *
 * Accepts a numeric string as well as a number: several API payloads deliver
 * `monto` as a string, and the call sites that used to interpolate those
 * directly are exactly where the second `$24.00` format came from.
 */
export function formatCurrency(amount: number | string | null | undefined): string {
  if (amount === null || amount === undefined || amount === "") return "$0,00";
  const value = typeof amount === "number" ? amount : Number(amount);
  if (!Number.isFinite(value)) return "$0,00";

  return new Intl.NumberFormat("es-EC", {
    style: "currency",
    currency: "USD",
  })
    .formatToParts(value)
    .filter((p) => p.type !== "literal")
    .map((p) => p.value)
    .join("");
}

/**
 * Format a date string as `dd/mm/yyyy` — the canonical product date format.
 *
 * Components are read in local time and padded by hand rather than delegated
 * to `toLocaleDateString`, so the output is byte-identical across ICU versions
 * and CI runners. Returns an empty string for invalid or empty input.
 */
export function formatDate(dateStr: string): string {
  const date = parseDateStringLocal(dateStr);
  if (!date) return "";
  return `${pad2(date.getDate())}/${pad2(date.getMonth() + 1)}/${date.getFullYear()}`;
}

/**
 * Format a date string as `dd/mm/yy` — the dense-table-cell variant.
 *
 * Deliberately the SAME grammar as `formatDate`, only shorter: a table that
 * switched to "24 jul" or "viernes, 24 jul" would reintroduce the second date
 * vocabulary this module exists to remove. Use it only where the column is
 * genuinely tight; prefer `formatDate` everywhere else.
 */
export function formatDateShort(dateStr: string): string {
  const date = parseDateStringLocal(dateStr);
  if (!date) return "";
  const yy = pad2(date.getFullYear() % 100);
  return `${pad2(date.getDate())}/${pad2(date.getMonth() + 1)}/${yy}`;
}

/**
 * Format a date string as `dd/mm/yyyy · HH:mm` (24-hour).
 *
 * Returns an empty string for invalid or empty date inputs.
 */
export function formatDateTime(dateStr: string): string {
  const date = parseDateStringLocal(dateStr);
  if (!date) return "";
  const time = `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
  return `${formatDate(dateStr)} · ${time}`;
}

/**
 * Format a start/end pair as `dd/mm/yyyy – dd/mm/yyyy` (en dash, U+2013).
 *
 * Degrades to whichever side parses when the other is missing, and to an
 * empty string when neither does — a half-rendered range is still readable,
 * a stray dash is not.
 */
export function formatDateRange(startStr: string, endStr: string): string {
  const start = formatDate(startStr);
  const end = formatDate(endStr);
  if (start && end) return `${start} – ${end}`;
  return start || end;
}

/**
 * Join a list of names into one Spanish enumeration — "Ana", "Ana y Luis",
 * "Ana, Luis y Sofía".
 *
 * It lives here for the same reason `formatDate` does: the product had already
 * grown one private copy of this grammar (`joinWithY` in
 * `app/groups/groups-page-utils.ts:159`, which builds a categoría's day line),
 * and the two shared primitives that arrived with D9 — the identity cell's
 * "Representante de …" and the week strip's accessible label — would have made
 * three. A separator is a format, and formats live in one file.
 *
 * Blank entries are dropped rather than joined, because the visible failure of
 * an enumeration is never a missing item: it is the ", y" or the " y " with
 * nothing on one side of it, which reads as a bug in a way an absent name does
 * not. An empty list returns an empty string so the caller can branch on it
 * instead of receiving a lone conjunction.
 *
 * No Oxford comma: Spanish does not take one ("Ana, Luis y Sofía").
 */
export function joinWithY(parts: readonly string[]): string {
  const kept = parts.filter((part) => part.trim() !== "");
  if (kept.length === 0) return "";
  if (kept.length === 1) return kept[0];
  return `${kept.slice(0, -1).join(", ")} y ${kept[kept.length - 1]}`;
}
