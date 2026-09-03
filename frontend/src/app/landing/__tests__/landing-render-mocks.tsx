/**
 * Registers the `next/image` / `LandingMap` / `LandingMotion` mocks that
 * `landing-image-delivery.test.tsx` and `landing-editorial-symmetry.test.tsx`
 * both need, from the doubles in `landing-test-doubles.tsx`.
 *
 * Import this module (for any binding, or just for its side effect) BEFORE
 * anything that itself imports `LandingPage`. Vitest hoists a `vi.mock` call
 * to the top of whatever module it is written in — never into an importer —
 * so writing the three calls here and importing this module is enough: ES
 * modules evaluate an imported module's top-level code, `vi.mock` calls
 * included, before the importer's own body runs.
 *
 * The factories below await their own dynamic `import()` of the doubles
 * rather than using a static import at the top of this file. A static
 * import binding referenced inside a factory throws "Cannot access '...'
 * before initialization", because THIS module's own `vi.mock` calls are, in
 * turn, hoisted above its own imports — including the one that would
 * otherwise supply `NextImageDouble` and friends. A dynamic `import()` is
 * not subject to that hoisting.
 *
 * A suite that needs its own variant of any of these three mocks (see
 * `landing-knowledge-parity.test.tsx`, which keeps a different `next/image`
 * double) must not import this module — importing it AND declaring a local
 * `vi.mock` for the same path both leaves Vitest to pick whichever
 * registration runs last, silently.
 */

import { vi } from "vitest";

vi.mock("next/image", async () => {
  const { NextImageDouble } = await import("./landing-test-doubles");
  return { __esModule: true, default: NextImageDouble };
});

vi.mock("@/app/landing/LandingMap", async () => {
  const { LandingMapDouble } = await import("./landing-test-doubles");
  return { default: LandingMapDouble };
});

vi.mock("@/app/landing/LandingMotion", async () => {
  const { LandingMotionDouble } = await import("./landing-test-doubles");
  return { default: LandingMotionDouble };
});
