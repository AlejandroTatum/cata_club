/** @vitest-environment jsdom */

/**
 * Structural lock — the Valores tablero redesign (approved prototype
 * `landing-valores-b-tablero.html`). Replaces the rally: no ball, no guide,
 * no scoreboard counter, no dimming. Four black numeral tiles sit in one
 * grid row, four value articles sit in the row below, and both rows come
 * from the SAME CSS grid — so the four titles share a top edge by
 * construction, not by a scroll choreography that could break on mobile
 * (the reason the rally was rejected).
 *
 * jsdom cannot lay out CSS Grid, so real alignment is out of scope here —
 * this suite anchors only the DOM shape: eight children in tile/tile/tile/
 * tile/item/item/item/item order, indices decorative, titles and copy in
 * document order for assistive technology, and the scroll cue pointing at
 * the real Palmarés section.
 */

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

describe("Valores tablero (rally replacement)", (): void => {
  it("renders four tiles then four items, in that source order", (): void => {
    const { container } = render(<LandingPage />);

    const tablero = container.querySelector("#valores .landing-tablero");
    expect(tablero).not.toBeNull();
    const children = Array.from(tablero!.children);
    expect(children.map((child): string => child.className)).toEqual([
      "landing-tablero-tile",
      "landing-tablero-tile",
      "landing-tablero-tile",
      "landing-tablero-tile",
      "landing-tablero-item",
      "landing-tablero-item",
      "landing-tablero-item",
      "landing-tablero-item",
    ]);
  });

  it("keeps the tile numerals decorative and the titles/copy the only accessible content", (): void => {
    const { container } = render(<LandingPage />);

    const tiles = container.querySelectorAll("#valores .landing-tablero-tile");
    tiles.forEach((tile): void => {
      expect(tile).toHaveAttribute("aria-hidden", "true");
    });

    const items = Array.from(container.querySelectorAll("#valores .landing-tablero-item"));
    expect(items.map((item): string | null => item.querySelector("h3")?.textContent ?? null)).toEqual([
      "Respeto",
      "Disciplina",
      "Esfuerzo",
      "Compañerismo",
    ]);
  });

  it("points the scroll cue at the real Palmarés section", (): void => {
    const { container } = render(<LandingPage />);

    const cue = container.querySelector("#valores .landing-tablero-cue");
    expect(cue).not.toBeNull();
    expect(cue).toHaveAttribute("href", "#logros");
    expect(container.querySelector("#logros")).not.toBeNull();
  });

  it("carries no rally, ball, guide, counter, or dimming machinery", (): void => {
    const { container } = render(<LandingPage />);

    const section = container.querySelector("#valores") as HTMLElement;
    expect(section.querySelector("[data-rally]")).toBeNull();
    expect(section.querySelector("svg")).toBeNull();
    expect(section.querySelectorAll("[data-value]")).toHaveLength(0);
    expect(section.querySelectorAll(".dim, .hit")).toHaveLength(0);
  });
});
