/**
 * The rules that make a wizard step a browser history entry.
 *
 * Back is the one control every user already knows, and in all four wizards it
 * used to leave the wizard from step 3 — taking a half-marked roll call or a
 * half-typed enrolment with it. Putting the step in the URL fixes that, but it
 * also opens the door the other way: a reload, a bookmark or a hand-edited URL
 * can now ASK for step 3 on a wizard whose client state is empty. These are the
 * clamping rules that keep that from rendering a confirmation of nothing.
 */

import { describe, it, expect } from "vitest";
import { furthestReachableIndex, resolveStepFromParam, stepParamValue } from "../wizard-history";

const ORDER = ["select-session", "mark-attendance", "confirm"] as const;
type Step = (typeof ORDER)[number];

/** Everything reachable — the wizard has its data loaded. */
const ALL = ORDER.length - 1;

function resolve(raw: string | null, maxReachableIndex = ALL): Step {
  return resolveStepFromParam<Step>(raw, ORDER, maxReachableIndex);
}

describe("resolveStepFromParam", () => {
  it("starts at the first step when the URL says nothing", () => {
    expect(resolve(null)).toBe("select-session");
  });

  it("reads a 1-based step number the way the stepper says it", () => {
    expect(resolve("1")).toBe("select-session");
    expect(resolve("2")).toBe("mark-attendance");
    expect(resolve("3")).toBe("confirm");
  });

  it("clamps a step the wizard cannot show yet", () => {
    // A reload: the roster never loaded, so step 3 is a confirmation of nothing.
    expect(resolve("3", 0)).toBe("select-session");
    expect(resolve("3", 1)).toBe("mark-attendance");
  });

  it("clamps a step past the end of the wizard", () => {
    expect(resolve("9")).toBe("confirm");
  });

  it("clamps a step before the beginning", () => {
    expect(resolve("0")).toBe("select-session");
    expect(resolve("-4")).toBe("select-session");
  });

  it("falls back to the first step for anything that is not a number", () => {
    expect(resolve("confirmar")).toBe("select-session");
    expect(resolve("")).toBe("select-session");
    expect(resolve("2x")).toBe("mark-attendance"); // parseInt semantics, still in range
    expect(resolve("NaN")).toBe("select-session");
  });

  it("never returns a step outside the order, whatever the reachable index says", () => {
    expect(resolve("2", 99)).toBe("mark-attendance");
    expect(resolve("2", -5)).toBe("select-session");
  });
});

describe("stepParamValue", () => {
  it("writes the same 1-based number the stepper shows", () => {
    expect(stepParamValue<Step>("select-session", ORDER)).toBe("1");
    expect(stepParamValue<Step>("mark-attendance", ORDER)).toBe("2");
    expect(stepParamValue<Step>("confirm", ORDER)).toBe("3");
  });

  it("round-trips through resolveStepFromParam", () => {
    for (const step of ORDER) {
      expect(resolve(stepParamValue<Step>(step, ORDER))).toBe(step);
    }
  });
});

// ---------------------------------------------------------------------------
// The form wizards answer "how far did this session get?" differently from the
// roll call: there is no single flag, only whether each step's fields are
// filled. A URL may address any step the visitor could have walked to on their
// own — no further, or a deep link would skip validation the wizard exists to
// enforce.
// ---------------------------------------------------------------------------

describe("furthestReachableIndex", () => {
  const STEPS = ["type", "personal", "health", "summary"] as const;
  type FormStep = (typeof STEPS)[number];

  function reachable(complete: FormStep[]): number {
    return furthestReachableIndex(STEPS, (step) => complete.includes(step));
  }

  it("stops at the first step of an untouched form", () => {
    expect(reachable([])).toBe(0);
  });

  it("advances one step past the last completed one", () => {
    expect(reachable(["type"])).toBe(1);
    expect(reachable(["type", "personal"])).toBe(2);
  });

  it("stops at the first gap, not at the last completed step", () => {
    // "health" being filled cannot unlock the summary while "personal" is not.
    expect(reachable(["type", "health"])).toBe(1);
  });

  it("never points past the last step, however complete the form is", () => {
    expect(reachable(["type", "personal", "health", "summary"])).toBe(STEPS.length - 1);
  });

  it("returns 0 for an empty order rather than -1", () => {
    expect(furthestReachableIndex([], () => true)).toBe(0);
  });
});
