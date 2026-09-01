/**
 * Unit tests for src/lib/status-badges.ts's membership status vocabulary.
 *
 * Issue #935: `suspendida` had a label but shared `vencida`'s `bad` tone,
 * so the two states were not visually distinguishable — a membership on
 * hold read the same as one owing money. `warn` is the existing amber
 * design token (already used for `pendiente`), reused here rather than
 * inventing a new colour.
 */
import { describe, it, expect } from "vitest";
import { MEMBERSHIP_STATUS_LABELS, MEMBERSHIP_STATUS_TONES } from "../status-badges";

describe("MEMBERSHIP_STATUS_TONES", () => {
  it("gives suspendida its own tone, distinct from vencida", () => {
    expect(MEMBERSHIP_STATUS_TONES.suspendida).not.toBe(MEMBERSHIP_STATUS_TONES.vencida);
  });

  it("uses the existing warn (amber) token for suspendida", () => {
    expect(MEMBERSHIP_STATUS_TONES.suspendida).toBe("warn");
  });
});

describe("MEMBERSHIP_STATUS_LABELS", () => {
  it('labels suspendida as "Suspendida"', () => {
    expect(MEMBERSHIP_STATUS_LABELS.suspendida).toBe("Suspendida");
  });
});
