/**
 * Issue #643 — a COMPLETE medical record must carry a real blood type.
 *
 * `DESCONOCIDO` ("No lo sé") is not deleted from the enum, and this file is
 * the place that says why: rows created before this rule still hold it, and
 * the trainer's emergency card and every read-only view must keep rendering
 * them. What changes is that it stops being OFFERED. `BLOOD_TYPES` remains
 * the wire vocabulary — everything the backend may ever hand us —
 * `SELECTABLE_BLOOD_TYPES` is the strictly smaller set a person may pick.
 *
 * Splitting the two is the whole point: a single list used for both is what
 * let the wizard offer a value the business rule rejects.
 */

import { describe, it, expect } from "vitest";
import { BLOOD_TYPES, BLOOD_TYPE_LABELS, SELECTABLE_BLOOD_TYPES } from "@/types/enrollment";

describe("SELECTABLE_BLOOD_TYPES", () => {
  it("never offers DESCONOCIDO as a choice", () => {
    expect(SELECTABLE_BLOOD_TYPES).not.toContain("DESCONOCIDO");
  });

  it("offers every other blood type the backend knows", () => {
    const expected = Object.values(BLOOD_TYPES).filter((value) => value !== "DESCONOCIDO");
    expect([...SELECTABLE_BLOOD_TYPES]).toEqual(expected);
  });

  it("keeps DESCONOCIDO in the wire vocabulary, so legacy rows still parse", () => {
    // Deleting it from `BLOOD_TYPES` would turn every pre-#643 record into an
    // unrecognised value at the boundary — the rule is about what may be
    // WRITTEN, not about pretending old data never existed.
    expect(Object.values(BLOOD_TYPES)).toContain("DESCONOCIDO");
  });

  it("keeps a human label for DESCONOCIDO, so a legacy row reads as words", () => {
    expect(BLOOD_TYPE_LABELS.DESCONOCIDO).toBe("No lo sé");
  });
});
