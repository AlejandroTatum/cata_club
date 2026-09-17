/**
 * The exact opaque token `src/instrumentation.ts` requires — not just any
 * truthy value — in `HERO_WARMUP_DISABLED` before it skips its own
 * fire-and-forget hero-image warm-up. Only
 * `tests/e2e/hero-image-optimizer-abort.spec.ts` (issue #1303) sets it,
 * only on the isolated child server it spawns for its own reproduction.
 *
 * Exported once from here, rather than declared separately in each file,
 * so the two can never drift apart into two literals that happen to match
 * today and silently stop matching after an edit to either side.
 */
export const HERO_WARMUP_DISABLE_TOKEN = "only-for-hero-image-optimizer-abort-spec";
