/** @vitest-environment jsdom */

/**
 * Structural lock — issue #863: the mirrored Mission/Vision section.
 *
 * `landing.css` used to draw the centre divider as a `border-left` on the
 * SECOND `.landing-editorial-item`, i.e. a property of one column rather than
 * of the wrapper that owns the symmetry (`.landing-editorial`). Because each
 * item also centred its own two children independently (`align-items:
 * center`, computed per item), the divider's ownership and the copy's
 * vertical anchor both drifted with whichever half happened to be taller.
 *
 * jsdom cannot lay out CSS Grid, so the real geometry (equal Y for both
 * headings, the 4:3 media boxes, the divider staying centred, no mobile
 * overflow) is measured in a real browser by
 * `tests/e2e/landing-mission-vision-symmetry.spec.ts`. What THIS suite can
 * anchor is the DOM shape those rules depend on: the divider must be a direct
 * child of the wrapper, never nested inside a column, and the composition
 * order (`[image][mission] | [vision][image]`) must survive.
 */

import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import LandingPage from "@/app/landing/LandingPage";
import { stubLandingGlobals } from "./landing-test-doubles";

// A `vi.mock` factory is hoisted above every import in this file, including
// the one that would otherwise supply the doubles above — a static import
// there throws "Cannot access '...' before initialization". Each factory
// awaits its own dynamic `import()` instead, which is not subject to that
// hoisting and is Vitest's documented way to share a mock implementation.
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

beforeEach((): void => {
  stubLandingGlobals();
});

afterEach((): void => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Mission/Vision editorial symmetry (issue #863)", (): void => {
  it("owns the divider on the wrapper, never on one of the two columns", (): void => {
    const { container } = render(<LandingPage />);

    const wrapper = container.querySelector(".landing-editorial");
    expect(wrapper).not.toBeNull();

    const divider = wrapper?.querySelector(":scope > .landing-editorial-divider");
    expect(divider, "the wrapper must have a divider as its own direct child").not.toBeNull();

    // The old bug: a border painted on the second `.landing-editorial-item`.
    // No column may carry a divider element of its own.
    const dividersInsideAColumn = wrapper?.querySelectorAll(".landing-editorial-item .landing-editorial-divider");
    expect(dividersInsideAColumn?.length ?? 0).toBe(0);
  });

  it("keeps the divider as the middle child, between the two mirrored halves", (): void => {
    const { container } = render(<LandingPage />);

    const wrapper = container.querySelector(".landing-editorial") as HTMLElement;
    const children = Array.from(wrapper.children);

    expect(children).toHaveLength(3);
    expect(children[0]).toHaveClass("landing-editorial-item");
    expect(children[1]).toHaveClass("landing-editorial-divider");
    expect(children[2]).toHaveClass("landing-editorial-item");
  });

  it("keeps the composition [image][mission] | [vision][image]", (): void => {
    const { container } = render(<LandingPage />);

    const [missionItem, visionItem] = container.querySelectorAll(".landing-editorial-item");
    expect(missionItem).not.toBeUndefined();
    expect(visionItem).not.toBeUndefined();

    // Mission: image leads, copy follows.
    const missionChildren = Array.from(missionItem.children);
    expect(missionChildren[0]).toHaveClass("landing-editorial-media");
    expect(missionChildren[1]).toHaveClass("landing-editorial-copy");

    // Vision inverts the grid: copy leads, image follows.
    const visionChildren = Array.from(visionItem.children);
    expect(visionChildren[0]).toHaveClass("landing-editorial-copy");
    expect(visionChildren[1]).toHaveClass("landing-editorial-media");
  });

  it("gives both editorial photos the same declared 4:3 geometry", (): void => {
    const { container } = render(<LandingPage />);

    const media = Array.from(container.querySelectorAll<HTMLImageElement>(".landing-editorial-media img"));
    expect(media).toHaveLength(2);

    for (const img of media) {
      const width = Number(img.getAttribute("width"));
      const height = Number(img.getAttribute("height"));
      expect(width / height).toBeCloseTo(4 / 3, 2);
    }
  });
});
