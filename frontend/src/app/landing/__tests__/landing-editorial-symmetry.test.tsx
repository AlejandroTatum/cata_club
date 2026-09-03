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

// Registers next/image/LandingMap/LandingMotion mocks as a side effect — see
// the doc comment there for why that is safe under Vitest's hoisting. This
// MUST come before `LandingPage` (or anything that imports it) below: sibling
// imports evaluate in source order, so a later position here would let
// `LandingPage`'s own `next/image` import resolve to the real module first.
// This file must not declare its own `vi.mock` for any of those three paths.
import "./landing-render-mocks";
import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import LandingPage from "@/app/landing/LandingPage";
import { resetLandingTestEnvironment, stubLandingGlobals } from "./landing-test-doubles";

beforeEach((): void => {
  stubLandingGlobals();
});

afterEach((): void => {
  resetLandingTestEnvironment();
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
