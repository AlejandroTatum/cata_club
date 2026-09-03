/** @vitest-environment jsdom */

/**
 * The simple card, decided 2026-09-02 over the prototype `horarios-simple.html`
 * (see `~/devwork/.projects/apps/cata_club-prototipos/horarios-simple.html`).
 * Issue #988 replaces the timeline (`schedule-timeline.ts`, deleted) with one
 * category list and one card that always shows the first slot's schedule in
 * large type, six day balls, the WhatsApp CTA and one line per extra slot.
 *
 * Reuses `stubLandingGlobals`/`resetLandingTestEnvironment` for the
 * `matchMedia`/`ResizeObserver` doubles the component's reduced-motion hook
 * reads, and `category`/`weekSlot`/`satSlot` from `schedule-fixtures.ts` for
 * the input catalog — the same builders `landing-config.test.ts` already
 * shares, so this file adds no second copy of either.
 */

import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LandingSchedule } from "@/app/landing/schedule-data";
import ScheduleSelector from "@/app/landing/ScheduleSelector";
import { toWhatsAppLink, landingConfig } from "@/app/landing/landing-config";
import { category, satSlot, weekSlot } from "./schedule-fixtures";
import { resetLandingTestEnvironment, stubLandingGlobals } from "./landing-test-doubles";

const WEEKDAYS = "Lunes, Martes, Miércoles, Jueves y Viernes";
const MON_WED_FRI = "Lunes, Miércoles y Viernes";

const SCHEDULES: LandingSchedule[] = [
  category("Formativo", [weekSlot("15:00 – 16:00", WEEKDAYS)], "5 a 10 años"),
  category("Infantil", [weekSlot("16:00 – 17:00", MON_WED_FRI)]),
  category("Competitivo", [weekSlot("18:00 – 20:00", WEEKDAYS), satSlot("18:00 – 20:00")]),
];

/** Reduced motion by default, like every other landing suite's quietest answer. */
function renderCard(schedules: LandingSchedule[] = SCHEDULES): ReturnType<typeof render> {
  stubLandingGlobals();
  return render(<ScheduleSelector schedules={schedules} />);
}

/** Overrides the shared stub so `(prefers-reduced-motion: reduce)` reports false. */
function allowMotion(): void {
  vi.stubGlobal("matchMedia", vi.fn((query: string): MediaQueryList => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  } as unknown as MediaQueryList)));
}

function litBallLabels(): string[] {
  return Array.from(document.querySelectorAll(".landing-schedule-day--on")).map(
    (ball): string => ball.textContent ?? "",
  );
}

describe("ScheduleSelector", (): void => {
  afterEach(resetLandingTestEnvironment);

  it("lights L, M, X, J, V for a category running Monday to Friday", (): void => {
    renderCard();
    expect(litBallLabels()).toEqual(["L", "M", "X", "J", "V"]);
  });

  it("lights only L, X, V for a category running Monday, Wednesday and Friday", (): void => {
    renderCard();
    fireEvent.click(screen.getByRole("tab", { name: /infantil/i }));
    expect(litBallLabels()).toEqual(["L", "X", "V"]);
  });

  it("lights only S for a Saturday-only first slot", (): void => {
    renderCard([category("Sabatino", [satSlot("15:00 – 18:00")])]);
    expect(litBallLabels()).toEqual(["S"]);
  });

  it("shows a secondary line only for slots after the first", (): void => {
    renderCard();
    const panel = screen.getByRole("tabpanel");
    expect(within(panel).queryByText(/también/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: /competitivo/i }));
    expect(within(panel).getByText(/También/)).toHaveTextContent("También 18:00–20:00 los sábado.");
  });

  it("adds no animation class to the digits or the lit balls with reduced motion", (): void => {
    renderCard();
    const panel = screen.getByRole("tabpanel");
    expect(panel.querySelector(".landing-schedule-time--animate")).toBeNull();
    expect(panel.querySelector(".landing-schedule-day--pop")).toBeNull();
  });

  it("adds the animation class to the digits and the lit balls without reduced motion", (): void => {
    allowMotion();
    render(<ScheduleSelector schedules={SCHEDULES} />);
    const panel = screen.getByRole("tabpanel");
    expect(panel.querySelector(".landing-schedule-time--animate")).not.toBeNull();
    expect(panel.querySelectorAll(".landing-schedule-day--pop").length).toBeGreaterThan(0);
  });

  it("points the CTA at the club's first WhatsApp number with a category-specific prefilled message", (): void => {
    renderCard();
    const cta = screen.getByRole("link", { name: /consultar cupo por whatsapp/i });
    expect(cta).toHaveAttribute(
      "href",
      `${toWhatsAppLink(landingConfig.contact.whatsapp[0])}?text=${encodeURIComponent("Hola, quiero consultar cupo en Formativo.")}`,
    );
    expect(cta).toHaveAttribute("target", "_blank");
    expect(cta).toHaveAttribute("rel", "noreferrer");

    fireEvent.click(screen.getByRole("tab", { name: /infantil/i }));
    expect(screen.getByRole("link", { name: /consultar cupo por whatsapp/i })).toHaveAttribute(
      "href",
      `${toWhatsAppLink(landingConfig.contact.whatsapp[0])}?text=${encodeURIComponent("Hola, quiero consultar cupo en Infantil.")}`,
    );
  });

  it("moves selection and focus with the arrow keys, keeping the tablist/tab/tabpanel roles", (): void => {
    renderCard();
    const tablist = screen.getByRole("tablist", { name: "Categorías" });
    const tabs = within(tablist).getAllByRole("tab");

    fireEvent.keyDown(tablist, { key: "ArrowDown" });
    expect(tabs[1]).toHaveAttribute("aria-selected", "true");
    expect(tabs[1]).toHaveFocus();

    fireEvent.keyDown(tablist, { key: "ArrowUp" });
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    expect(tabs[0]).toHaveFocus();

    expect(screen.getByRole("tabpanel")).toHaveAttribute("aria-live", "polite");
  });

  it("keeps the day balls decorative and names the days in text on the group", (): void => {
    renderCard();
    const group = document.querySelector(".landing-schedule-days") as HTMLElement;
    expect(group).toHaveAttribute("aria-label", WEEKDAYS);
    within(group).queryAllByText(/^[LMXJVS]$/).forEach((ball): void => {
      expect(ball).toHaveAttribute("aria-hidden", "true");
    });
  });
});
