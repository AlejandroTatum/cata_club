/**
 * Minimal className joiner for the UI primitives.
 *
 * Deliberately not `clsx` — the primitives only ever need "drop the falsy ones
 * and join with a space", and this repo has no runtime class-merging need
 * (each primitive owns its own layout classes; callers only append).
 */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
