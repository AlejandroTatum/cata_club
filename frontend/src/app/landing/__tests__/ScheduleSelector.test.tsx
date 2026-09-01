/** @vitest-environment jsdom */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { LandingSchedule } from "@/app/landing/schedule-data";
import ScheduleSelector from "@/app/landing/ScheduleSelector";

const landingCss = (): string =>
  readFileSync(resolve(process.cwd(), "src/app/landing/landing.css"), "utf8");

const SCHEDULES: LandingSchedule[] = [
  { category: "Sub-10", slots: [{ hours: "16:00 - 17:00", days: "Lunes a Viernes", on: "week" }] },
  { category: "Sub-14", slots: [{ hours: "17:00 - 18:30", days: "Lunes a Viernes", on: "week" }] },
];

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
