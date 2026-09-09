/** @vitest-environment jsdom */

import "./landing-render-mocks";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Palmares from "@/app/landing/Palmares";
import { ACHIEVEMENT_GROUPS } from "@/app/landing/landing-logros";

const AUTO_ADVANCE_INTERVAL_MS = 10_000;
let reducedMotion = false;

function stubMatchMedia(): void {
  vi.stubGlobal("matchMedia", vi.fn((query: string): MediaQueryList => ({
    matches: query === "(prefers-reduced-motion: reduce)" ? reducedMotion : false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }) as unknown as MediaQueryList));
}

beforeEach((): void => {
  reducedMotion = false;
  stubMatchMedia();
});

afterEach((): void => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Logros data and carousel", (): void => {
  it("groups the approved institutional results by competition", (): void => {
    expect(ACHIEVEMENT_GROUPS).toHaveLength(7);
    expect(ACHIEVEMENT_GROUPS.map(({ id }) => id)).toEqual([
      "south-american-doubles-2026",
      "south-american-qualifiers-2025",
      "pan-american-qualifiers-2025",
      "national-selective-cuenca-2024",
      "national-selective-pichincha-2024",
      "europe-world-circuit-2019",
      "national-podiums-2017-2019",
    ]);
    expect(ACHIEVEMENT_GROUPS[0]).toMatchObject({
      year: "2026",
      venue: "Asunción, Paraguay",
      result: "Medalla de bronce en dobles",
      athletes: "Eleana Ochoa y Dana Palma",
    });
    expect(ACHIEVEMENT_GROUPS[3]).toMatchObject({
      year: "2024",
      category: "10–12",
      result: "Siete colocaciones",
    });
    expect(ACHIEVEMENT_GROUPS[4]).toMatchObject({
      year: "2024",
      category: "14–18",
      result: "Equipo medallista de bronce",
    });
  });

  it("describes the 2025 records as qualification outcomes", (): void => {
    expect(ACHIEVEMENT_GROUPS[1].story).toMatch(/obtuvieron la clasificación/i);
    expect(ACHIEVEMENT_GROUPS[2].story).toMatch(/obtuvieron la clasificación/i);
    expect(ACHIEVEMENT_GROUPS.slice(1, 3).map(({ story }) => story).join(" ")).not.toMatch(/participaron en los clasificatorios/i);
  });

  it("works when the browser does not expose matchMedia", (): void => {
    vi.stubGlobal("matchMedia", undefined);
    vi.useFakeTimers();
    render(<Palmares />);

    act((): void => { vi.advanceTimersByTime(AUTO_ADVANCE_INTERVAL_MS); });
    expect(screen.getByRole("tab", { name: /Clasificados al Sudamericano/i })).toHaveAttribute("aria-selected", "true");
  });

  it("renders competition tabs with selected semantics and provisional image labeling", (): void => {
    render(<Palmares />);

    const carousel = screen.getByRole("region", { name: "Logros deportivos" });
    const tabs = within(carousel).getAllByRole("tab");
    expect(tabs).toHaveLength(ACHIEVEMENT_GROUPS.length);
    expect(carousel).toHaveAttribute("aria-roledescription", "carousel");
    expect(carousel.querySelector("[role=tabpanel]")).toBeNull();
    const slide = within(carousel).getByRole("group", { name: "Logro 1 de 7: Bronce sudamericano en dobles" });
    expect(slide).toHaveAttribute("aria-roledescription", "slide");
    expect(slide).toHaveAccessibleName("Logro 1 de 7: Bronce sudamericano en dobles");
    expect(within(carousel).getByText("1 / 7")).toBeInTheDocument();
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    expect(tabs[0]).toHaveAttribute("aria-current", "true");
    expect(within(carousel).getByText(/imágenes de referencia provisionales/i)).toBeInTheDocument();
    expect(within(carousel).getByRole("img")).toHaveAccessibleName(/imagen de referencia provisional/i);
  });

  it("declares thumbnail sizes at the tab's real render width (issue #1154, #1159)", (): void => {
    render(<Palmares />);

    const thumbnails = Array.from(document.querySelectorAll<HTMLImageElement>(".landing-logro-tab img"));
    expect(thumbnails).toHaveLength(ACHIEVEMENT_GROUPS.length);
    // Below 1550px viewport width the tabs sit at their 176px floor, so the
    // photo renders at 176px minus its 2x6px padding and 2x1px border
    // (162px) — the box-sizing: border-box content width. Issue #1159 lets
    // the tabs grow past that viewport to fill the tablist, so the wide
    // branch is pinned to the widest realistic desktop render (206px,
    // derived in Palmares.tsx) instead of a `vw` unit, which would drop
    // next/image off its small candidate ladder. Change the CSS card and
    // this string together.
    for (const img of thumbnails) {
      expect(img.getAttribute("sizes")).toBe("(max-width: 1550px) 162px, 206px");
    }
  });

  it("updates the main story, fact sheet and selected tab when a competition is selected", (): void => {
    render(<Palmares />);

    fireEvent.click(screen.getByRole("tab", { name: /Selectiva Nacional · Cuenca/i }));

    const carousel = screen.getByRole("region", { name: "Logros deportivos" });
    expect(within(carousel).getByRole("tab", { name: /Selectiva Nacional · Cuenca/i })).toHaveAttribute("aria-selected", "true");
    expect(within(carousel).getByRole("heading", { level: 3 })).toHaveTextContent(/Siete colocaciones/i);
    expect(within(carousel).getByText(/2024/)).toBeInTheDocument();
    expect(within(carousel).getByText("Categorías").closest(".landing-logro-fact")).toHaveTextContent("10–12");
    expect(within(carousel).getByText(/inventario institucional/i)).toBeInTheDocument();
  });

  it("auto-advances every ten seconds and direct selection restarts the interval", (): void => {
    vi.useFakeTimers();
    render(<Palmares />);

    act((): void => { vi.advanceTimersByTime(AUTO_ADVANCE_INTERVAL_MS); });
    expect(screen.getByRole("tab", { name: /Clasificados al Sudamericano/i })).toHaveAttribute("aria-selected", "true");

    fireEvent.click(screen.getByRole("tab", { name: /Selectiva Nacional · Pichincha/i }));
    act((): void => { vi.advanceTimersByTime(AUTO_ADVANCE_INTERVAL_MS - 1); });
    expect(screen.getByRole("tab", { name: /Selectiva Nacional · Pichincha/i })).toHaveAttribute("aria-selected", "true");
    act((): void => { vi.advanceTimersByTime(1); });
    expect(screen.getByRole("tab", { name: /Circuito europeo y mundial/i })).toHaveAttribute("aria-selected", "true");
  });

  it("pauses on hover or focus, supports pause/resume, and never auto-advances with reduced motion", (): void => {
    vi.useFakeTimers();
    render(<Palmares />);
    const carousel = screen.getByRole("region", { name: "Logros deportivos" });

    fireEvent.mouseOver(carousel);
    act((): void => { vi.advanceTimersByTime(AUTO_ADVANCE_INTERVAL_MS * 2); });
    expect(screen.getByRole("tab", { name: /2026 · Sudamericano/i })).toHaveAttribute("aria-selected", "true");
    fireEvent.mouseOut(carousel, { relatedTarget: document.body });
    act((): void => { vi.advanceTimersByTime(AUTO_ADVANCE_INTERVAL_MS); });
    expect(screen.getByRole("tab", { name: /Clasificados al Sudamericano/i })).toHaveAttribute("aria-selected", "true");

    fireEvent.focus(screen.getByRole("button", { name: "Pausar logros" }));
    act((): void => { vi.advanceTimersByTime(AUTO_ADVANCE_INTERVAL_MS); });
    expect(screen.getByRole("tab", { name: /Clasificados al Sudamericano/i })).toHaveAttribute("aria-selected", "true");

    fireEvent.click(screen.getByRole("button", { name: "Pausar logros" }));
    expect(screen.getByRole("button", { name: "Reanudar logros" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reanudar logros" }));

    reducedMotion = true;
    stubMatchMedia();
    cleanup();
    render(<Palmares />);
    fireEvent.click(screen.getByRole("tab", { name: /Clasificados al Panamericano/i }));
    act((): void => { vi.advanceTimersByTime(AUTO_ADVANCE_INTERVAL_MS * 2); });
    expect(screen.getByRole("tab", { name: /Clasificados al Panamericano/i })).toHaveAttribute("aria-selected", "true");
  });

  it("provides previous/next controls and arrow-key tab navigation", (): void => {
    render(<Palmares />);
    const tabs = screen.getAllByRole("tab");

    fireEvent.keyDown(tabs[0], { key: "ArrowRight" });
    expect(tabs[1]).toHaveFocus();
    fireEvent.keyDown(tabs[1], { key: "Enter" });
    expect(tabs[1]).toHaveAttribute("aria-selected", "true");

    fireEvent.click(screen.getByRole("button", { name: "Logro anterior" }));
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    fireEvent.click(screen.getByRole("button", { name: "Logro siguiente" }));
    expect(tabs[1]).toHaveAttribute("aria-selected", "true");
  });
});
