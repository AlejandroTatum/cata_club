/** @vitest-environment jsdom */

/**
 * Issue #1399: on phones the institutional-stats band («2013 / 12 años /
 * Loja») becomes three hairline-ruled rows (figure beside its caption)
 * instead of one undivided strip.
 *
 * jsdom performs no layout and cannot match media queries, so — the same
 * convention `landing-stats-band.test.ts` and `landing-vertical-space.test.ts`
 * use — the mobile treatment is locked by reading the authored stylesheet's
 * `(max-width: 768px)` block directly. What lives here is the contract that
 * the row treatment exists ONLY at that breakpoint: the base `.landing-stat`
 * rule must stay bare (desktop keeps the ledger columns, the #691 locks in
 * `landing-stats-band.test.ts` still guard it), and the rendered DOM must
 * stay three separate stat blocks carrying the same factual figures.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import "./landing-render-mocks";
import LandingPage from "../LandingPage";

interface MockedMediaQueryList extends MediaQueryList {
  addEventListener: Mock;
  removeEventListener: Mock;
}

const landingCss = (): string =>
  readFileSync(resolve(process.cwd(), "src/app/landing/landing.css"), "utf8");

/** The whole `@media (max-width: 768px)` block, from its header to EOF. */
function mobileBlock(css: string): string {
  const start = css.indexOf("@media (max-width: 768px)");
  if (start === -1) throw new Error("mobile breakpoint block not found");
  return css.slice(start);
}

/** The first `<selector> { ... }` rule inside `block`, as raw text. */
function ruleIn(block: string, selector: string): string {
  const start = block.indexOf(`${selector} {`);
  if (start === -1) throw new Error(`rule not found in mobile block: ${selector}`);
  const end = block.indexOf("}", start);
  return block.slice(start, end + 1);
}

describe("landing stats mobile cards (#1399)", (): void => {
  // The same per-file browser doubles every full-page render test here uses
  // (LandingPage.test.tsx): jsdom has no matchMedia, ResizeObserver, or a
  // fetch that can answer the page's relative public API calls. Stats itself
  // is synchronous and static, so empty payloads keep everything else quiet.
  beforeEach((): void => {
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL): Promise<{ ok: boolean; json: () => Promise<unknown> }> =>
      Promise.resolve({ ok: true, json: async (): Promise<unknown> => [] })));
    vi.stubGlobal("ResizeObserver", class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    });
    vi.stubGlobal("matchMedia", vi.fn((query: string): MockedMediaQueryList => ({
      matches: query === "(prefers-reduced-motion: reduce)",
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }) as MockedMediaQueryList));
  });

  it("turns the ledger into hairline-ruled rows with the figure beside its caption", (): void => {
    const css = mobileBlock(landingCss());
    expect(ruleIn(css, ".landing-stat strong")).toContain("min-width: 124px");
    expect(ruleIn(css, ".landing-stat + .landing-stat")).toContain("border-top: 1px solid var(--landing-border)");
    expect(ruleIn(css, ".landing-stat + .landing-stat")).toContain("border-left: 0");
  });

  it("keeps the ruled treatment out of the base rule, so desktop keeps the left-aligned columns", (): void => {
    const baseRule = landingCss().match(/\.landing-stat \{[^}]*\}/)?.[0] ?? "";
    expect(baseRule).not.toMatch(/background/);
    expect(baseRule).not.toMatch(/border/);
    expect(baseRule).not.toMatch(/box-shadow/);
    expect(baseRule).not.toMatch(/border-radius/);
  });

  it("stacks the three rows in one column instead of leaving an empty grid cell", (): void => {
    const statsRule = ruleIn(mobileBlock(landingCss()), ".landing-stats");
    expect(statsRule).toContain("flex-direction: column");
    expect(statsRule).not.toContain("grid-template-columns");
  });

  it("leaves the band's own warm background untouched at the mobile breakpoint", (): void => {
    const statsRule = ruleIn(mobileBlock(landingCss()), ".landing-stats");
    expect(statsRule).not.toMatch(/background/);
  });

  it("renders the band as exactly three separate stat blocks with the factual figures preserved", async (): Promise<void> => {
    const { container } = render(<LandingPage />);
    const stats = Array.from(container.querySelectorAll(".landing-stats .landing-stat"));
    expect(stats).toHaveLength(3);
    expect(stats.map((stat): string => stat.querySelector("strong")?.textContent ?? "")).toEqual([
      "2013",
      "12",
      "Loja",
    ]);
    expect(stats.map((stat): string => stat.querySelector("span")?.textContent ?? "")).toEqual([
      "Desde el 10 de octubre",
      "Años formando deportistas",
      "Junto al Coliseo Ciudad de Loja",
    ]);
  });
});
