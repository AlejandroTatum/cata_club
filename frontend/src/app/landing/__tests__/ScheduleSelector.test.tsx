/** @vitest-environment jsdom */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { LandingSchedule } from "@/app/landing/schedule-data";
import ScheduleSelector from "@/app/landing/ScheduleSelector";
import { category, weekSlot } from "./schedule-fixtures";

const landingCss = (): string =>
  readFileSync(resolve(process.cwd(), "src/app/landing/landing.css"), "utf8");

const SCHEDULES: LandingSchedule[] = [
  { category: "Sub-10", slots: [{ hours: "16:00 - 17:00", days: "Lunes a Viernes", on: "week" }] },
  { category: "Sub-14", slots: [{ hours: "17:00 - 18:30", days: "Lunes a Viernes", on: "week" }] },
];

/** Two back-to-back weekday slots in the same lane — issue #872's "múltiples
 * slots por día" case, shared through `schedule-fixtures.ts` rather than
 * restated here. */
const MULTI_SLOT: LandingSchedule[] = [category("Noche", [weekSlot("18:00 – 20:00"), weekSlot("20:00 – 21:15")])];

/**
 * jsdom performs no real layout — offsetTop/offsetHeight are always 0. Stub
 * them deterministically per element (keyed by the tab's own id, which is
 * known ahead of render) so the marker's geometry math can be asserted
 * against known numbers instead of trusting layout jsdom never computes.
 */
const TAB_GEOMETRY = [
  { top: 0, height: 90 },
  { top: 90, height: 70 },
];
const TRACK_HEIGHT = 160;

function stubLayout(): void {
  Object.defineProperty(HTMLElement.prototype, "offsetTop", {
    configurable: true,
    get(this: HTMLElement): number {
      const index = this.id?.match(/^schedule-tab-(\d+)$/)?.[1];
      return index !== undefined ? TAB_GEOMETRY[Number(index)].top : 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get(this: HTMLElement): number {
      const index = this.id?.match(/^schedule-tab-(\d+)$/)?.[1];
      if (index !== undefined) return TAB_GEOMETRY[Number(index)].height;
      return this.classList.contains("landing-sched-list") ? TRACK_HEIGHT : 0;
    },
  });
}

function markerStyle(): CSSStyleDeclaration {
  const marker = document.querySelector(".landing-sched-marker");
  expect(marker).not.toBeNull();
  return (marker as HTMLElement).style;
}

describe("ScheduleSelector marker", (): void => {
  beforeEach(stubLayout);
  afterEach((): void => {
    cleanup();
  });

  it("drives the marker's geometry through custom properties, never through top/height inline styles", (): void => {
    render(<ScheduleSelector schedules={SCHEDULES} />);

    const style = markerStyle();
    // top/height are the layout-triggering properties the issue targets —
    // if either is set inline, the marker is still animating layout.
    expect(style.top).toBe("");
    expect(style.height).toBe("");
    expect(style.getPropertyValue("--landing-sched-marker-top")).toBe("10px");
    expect(style.getPropertyValue("--landing-sched-marker-bar")).toBe("70px");
    expect(style.getPropertyValue("--landing-sched-marker-track")).toBe("160px");
  });

  it("re-measures against the newly selected tab's real offsets on selection change", (): void => {
    render(<ScheduleSelector schedules={SCHEDULES} />);

    fireEvent.click(screen.getAllByRole("tab")[1]);

    const style = markerStyle();
    expect(style.getPropertyValue("--landing-sched-marker-top")).toBe("100px");
    expect(style.getPropertyValue("--landing-sched-marker-bar")).toBe("50px");
    expect(style.getPropertyValue("--landing-sched-marker-track")).toBe("160px");
  });
});

describe("ScheduleSelector day-bar range labels", (): void => {
  afterEach((): void => {
    cleanup();
  });

  it("renders the compact HH:MM–HH:MM label inside each bar, aria-hidden, without touching the existing title", (): void => {
    render(<ScheduleSelector schedules={SCHEDULES} />);

    const bar = document.querySelector(".landing-day-bar") as HTMLElement;
    expect(bar).not.toBeNull();
    expect(bar.getAttribute("title")).toBe("Sub-10 · 16:00 - 17:00 · Lunes a Viernes");

    const label = bar.querySelector(".landing-day-bar-label");
    expect(label).not.toBeNull();
    expect(label?.textContent).toBe("16:00–17:00");
    expect(label?.getAttribute("aria-hidden")).toBe("true");
  });

  it("gives each bar its own accessible label with category, hours and days, matching the title", (): void => {
    render(<ScheduleSelector schedules={SCHEDULES} />);

    const bar = document.querySelector(".landing-day-bar") as HTMLElement;
    expect(bar.getAttribute("role")).toBe("img");
    expect(bar.getAttribute("aria-label")).toBe(bar.getAttribute("title"));
    expect(bar.getAttribute("aria-label")).toBe("Sub-10 · 16:00 - 17:00 · Lunes a Viernes");
  });

  it("keeps the track's own generic context — a group, not an unlabelled image, once bars carry their own labels", (): void => {
    render(<ScheduleSelector schedules={SCHEDULES} />);

    const track = document.querySelector(".landing-day-track") as HTMLElement;
    expect(track.getAttribute("role")).toBe("group");
    expect(track.getAttribute("aria-label")).toBe(
      "Distribución de los horarios de la categoría seleccionada",
    );
  });

  it("renders a distinct compact label and accessible label per slot for a multi-slot lane", (): void => {
    render(<ScheduleSelector schedules={MULTI_SLOT} />);

    const bars = Array.from(document.querySelectorAll(".landing-day-bar"));
    expect(bars).toHaveLength(2);
    expect(bars.map((bar): string | null => bar.querySelector(".landing-day-bar-label")?.textContent ?? null)).toEqual([
      "18:00–20:00",
      "20:00–21:15",
    ]);
    // Distinct aria-labels — no collision between the two slots.
    const labels = new Set(bars.map((bar): string | null => bar.getAttribute("aria-label")));
    expect(labels.size).toBe(2);
  });
});

describe("landing-sched-marker stylesheet", (): void => {
  it("transitions clip-path only — no layout property (top/height) is animated anymore", (): void => {
    const rule = landingCss().match(/\.landing-sched-marker \{[\s\S]*?\}/)?.[0] ?? "";

    expect(rule).toMatch(/transition:\s*clip-path/);
    expect(rule).not.toMatch(/transition:[^;]*\btop\b/);
    expect(rule).not.toMatch(/transition:[^;]*\bheight\b/);
  });

  it("keeps the marker's fixed geometry (width, radius, color) exactly as before", (): void => {
    const rule = landingCss().match(/\.landing-sched-marker \{[\s\S]*?\}/)?.[0] ?? "";

    expect(rule).toMatch(/width:\s*4px/);
    expect(rule).toMatch(/background:\s*var\(--landing-action\)/);
    expect(rule).toMatch(/pointer-events:\s*none/);
  });
});

describe("landing-day-bar-label stylesheet — issue #872", (): void => {
  /**
   * jsdom never evaluates container queries (no real layout, so a bar's
   * rendered width is always 0), so the narrow-bar fallback itself can only
   * be proven in a real engine — see `tests/e2e/schedule-bar-labels.spec.ts`,
   * which measures actual bounding boxes at 1440 and 390. This suite only
   * proves the rule shape reaches the stylesheet.
   */
  it("centers the compact label inside the bar with tabular numerals, nowrap and a legible shadow", (): void => {
    const rule = landingCss().match(/\.landing-day-bar-label \{[\s\S]*?\}/)?.[0] ?? "";

    expect(rule).toMatch(/font-variant-numeric:\s*tabular-nums/);
    expect(rule).toMatch(/white-space:\s*nowrap/);
    expect(rule).toMatch(/text-shadow:/);
  });

  it("turns the bar into a container so the label can react to its own rendered width", (): void => {
    const rule = landingCss().match(/\.landing-day-bar \{[\s\S]*?\}/)?.[0] ?? "";

    expect(rule).toMatch(/container-type:\s*inline-size/);
  });

  it("stops clipping the lane vertically, so a fallback label can step outside a narrow bar", (): void => {
    const rule = landingCss().match(/\.landing-day-lane \{[\s\S]*?\}/)?.[0] ?? "";

    expect(rule).not.toMatch(/overflow:\s*hidden/);
  });

  it("defines a narrow-bar fallback that anchors the label outside the bar instead of centering it inside", (): void => {
    const container = landingCss().match(/@container \(max-width:[^{]*\{[\s\S]*?\n\}\n/)?.[0] ?? "";

    expect(container).toMatch(/max-width:\s*\d+px/);
    expect(container).toMatch(/\.landing-day-bar-label/);
    // Back-to-back bars in the same lane alternate sides so two adjacent
    // fallback labels never grow toward each other.
    expect(container).toMatch(/nth-of-type\(odd\)/);
  });
});
