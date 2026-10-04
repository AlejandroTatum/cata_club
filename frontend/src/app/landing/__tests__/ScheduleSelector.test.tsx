/** @vitest-environment jsdom */

/**
 * Proposal C of the Horarios prototypes (`odd/prototipos/horarios-v3`): every
 * category is a card on screen at once — age as the headline, an age bar that
 * shows overlaps, time, days and a WhatsApp button — plus a "no sabe cuál
 * elegir" card. Nothing here is interactive beyond plain links.
 *
 * Builders come from `schedule-fixtures.ts`, the same ones `landing-config`'s
 * suite shares, so no second copy of a catalog lives in this file.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LandingSchedule } from "@/app/landing/schedule-data";
import ScheduleSelector from "@/app/landing/ScheduleSelector";
import { toWhatsAppLink, landingConfig } from "@/app/landing/landing-config";
import { category, satSlot, weekSlot } from "./schedule-fixtures";
import { resetLandingTestEnvironment, stubLandingGlobals } from "./landing-test-doubles";

const WEEKDAYS = "Lunes, Martes, Miércoles, Jueves y Viernes";
const MON_WED_FRI = "Lunes, Miércoles y Viernes";

const SCHEDULES: LandingSchedule[] = [
  category("Competitivo", [weekSlot("18:00 – 20:00", WEEKDAYS), satSlot("18:00 – 20:00")], "Selección"),
  category("Adultos", [weekSlot("20:00 – 21:15", WEEKDAYS)], "Mayores de 18 años"),
  category("Infantil", [weekSlot("16:00 – 17:00", MON_WED_FRI)], "8 a 12 años"),
  category("Formativo", [weekSlot("15:00 – 16:00", WEEKDAYS)], "5 a 10 años"),
  category("Juvenil", [weekSlot("17:00 – 18:00", WEEKDAYS)], "Mayores de 12 años"),
  category("Juego Libre", [satSlot("15:00 – 18:00")]),
];

const WA = toWhatsAppLink(landingConfig.contact.whatsapp[0]);

function renderCards(schedules: LandingSchedule[] = SCHEDULES): ReturnType<typeof render> {
  stubLandingGlobals();
  return render(<ScheduleSelector schedules={schedules} />);
}

function card(name: string): HTMLElement {
  return screen.getByRole("heading", { level: 3, name }).closest("li") as HTMLElement;
}

function litCells(target: HTMLElement): number[] {
  return Array.from(target.querySelectorAll(".landing-schedule-scale i")).flatMap((cell, index): number[] =>
    cell.classList.contains("landing-schedule-scale-on") ? [index] : []);
}

describe("ScheduleSelector (cards side by side)", (): void => {
  afterEach(resetLandingTestEnvironment);

  it("renders one card per category in a list, youngest first and unnumbered labels last, then the help card", (): void => {
    renderCards();
    const list = screen.getByRole("list", { name: "Categorías" });
    const names = within(list).getAllByRole("heading", { level: 3 }).map((heading): string => heading.textContent ?? "");
    expect(names).toEqual(["Formativo", "Infantil", "Juvenil", "Adultos", "Competitivo", "Juego Libre", "¿No sabes cuál elegir?"]);
  });

  it("leads each card with its age label, and omits it when the category publishes none", (): void => {
    renderCards();
    expect(within(card("Formativo")).getByText("5 a 10 años")).toBeInTheDocument();
    expect(within(card("Competitivo")).getByText("Selección")).toBeInTheDocument();
    expect(card("Juego Libre").querySelector(".landing-schedule-ages")).toBeNull();
    // "Edad" labels an age; a squad name like "Selección" is not one.
    expect(within(card("Formativo")).getByText("Edad")).toBeInTheDocument();
    expect(within(card("Competitivo")).queryByText("Edad")).toBeNull();
  });

  it("shows the time and compacted days from the data, one line per extra slot", (): void => {
    renderCards();
    const formativo = card("Formativo");
    expect(formativo.querySelector(".landing-schedule-time")).toHaveTextContent("15:00 – 16:00");
    expect(within(formativo).getByText("Lunes a viernes")).toBeInTheDocument();
    expect(within(card("Infantil")).getByText(MON_WED_FRI)).toBeInTheDocument();

    const competitivo = card("Competitivo");
    expect(competitivo.querySelectorAll(".landing-schedule-slot")).toHaveLength(2);
    expect(within(competitivo).getByText("Sábado")).toBeInTheDocument();
  });

  it("links every card to the club's first WhatsApp number with a message naming its category", (): void => {
    renderCards();
    SCHEDULES.forEach((schedule): void => {
      const link = within(card(schedule.category)).getByRole("link", { name: `Preguntar por cupos en ${schedule.category} por WhatsApp` });
      expect(link).toHaveAttribute("href", `${WA}?text=${encodeURIComponent(`Hola, quiero consultar cupo en ${schedule.category}.`)}`);
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", "noreferrer");
    });
  });

  it("marks on the age bar exactly the ages of each category, so overlaps are visible", (): void => {
    renderCards();
    // Scale 5..18 → 14 cells; index = age - 5.
    expect(litCells(card("Formativo"))).toEqual([0, 1, 2, 3, 4, 5]);
    expect(litCells(card("Infantil"))).toEqual([3, 4, 5, 6, 7]);
    expect(litCells(card("Juvenil"))).toEqual([8, 9, 10, 11, 12]);
    expect(litCells(card("Adultos"))).toEqual([13]);
    const formativo = card("Formativo");
    expect(formativo.querySelectorAll(".landing-schedule-scale i")).toHaveLength(14);
    expect(formativo.querySelector(".landing-schedule-scale-labels")).toHaveTextContent("518+");
    expect(formativo.querySelector(".landing-schedule-scale")).toHaveAttribute("aria-hidden", "true");
  });

  it("draws no bar for a category without numeric ages", (): void => {
    renderCards();
    expect(card("Competitivo").querySelector(".landing-schedule-scale")).toBeNull();
    expect(card("Juego Libre").querySelector(".landing-schedule-scale")).toBeNull();
  });

  it("draws no bars at all when no category publishes a numeric age", (): void => {
    const { container } = renderCards([category("Libre", [satSlot("15:00 – 18:00")])]);
    expect(container.querySelector(".landing-schedule-scale")).toBeNull();
    expect(container.querySelector(".landing-schedule-note")).toBeNull();
  });

  it("closes with a 'no sabe cuál elegir' card that asks for help over WhatsApp", (): void => {
    renderCards();
    const help = screen.getByRole("heading", { level: 3, name: "¿No sabes cuál elegir?" }).closest("li") as HTMLElement;
    expect(within(help).getByRole("link", { name: /abrir whatsapp/i })).toHaveAttribute(
      "href",
      `${WA}?text=${encodeURIComponent("Hola, quiero ayuda para elegir categoría.")}`,
    );
    expect(help.parentElement?.lastElementChild).toBe(help);
  });

  it("has no tabs, day balls or rolling digits left from the old selector", (): void => {
    const { container } = renderCards();
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(container.querySelector(".landing-schedule-day, .landing-schedule-digit")).toBeNull();
  });

  it("renders a card per category from whatever the club publishes, never a fixed list", (): void => {
    renderCards([category("Nocturno", [weekSlot("22:00 – 23:00", MON_WED_FRI)], "6 a 9 años")]);
    expect(screen.getAllByRole("heading", { level: 3 }).map((heading): string => heading.textContent ?? "")).toEqual([
      "Nocturno",
      "¿No sabes cuál elegir?",
    ]);
  });

  describe("entrance and hover motion", (): void => {
    const css = (): string => readFileSync(resolve(process.cwd(), "src/app/landing/landing.css"), "utf8");

    function stubObserver(): { fire: () => void } {
      let callback: IntersectionObserverCallback = (): void => undefined;
      vi.stubGlobal("IntersectionObserver", class {
        constructor(cb: IntersectionObserverCallback) { callback = cb; }
        observe(): void {}
        disconnect(): void {}
      });
      return { fire: (): void => callback([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver) };
    }

    it("arms the grid when mounted and reveals it on first scroll into view", (): void => {
      const observer = stubObserver();
      stubLandingGlobals();
      vi.stubGlobal("matchMedia", vi.fn((query: string) => ({ matches: false, media: query })));
      vi.stubGlobal("IntersectionObserver", globalThis.IntersectionObserver);
      const { container } = render(<ScheduleSelector schedules={SCHEDULES} />);
      const grid = container.querySelector(".landing-schedule-grid") as HTMLElement;
      expect(grid.dataset.scheduleReveal).toBe("armed");
      act((): void => observer.fire());
      expect(grid.dataset.scheduleReveal).toBe("in");
    });

    it("leaves the cards visible, never armed, under reduced motion", (): void => {
      stubObserver();
      stubLandingGlobals();
      vi.stubGlobal("matchMedia", vi.fn((query: string) => ({ matches: query.includes("reduce"), media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
      const { container } = render(<ScheduleSelector schedules={SCHEDULES} />);
      expect((container.querySelector(".landing-schedule-grid") as HTMLElement).dataset.scheduleReveal).toBeUndefined();
    });

    it("styles the stagger, the hover/focus lift and the reduced-motion reset in the stylesheet", (): void => {
      const sheet = css();
      expect(sheet).toContain('[data-schedule-reveal="in"] .landing-schedule-tile');
      expect(sheet).toContain(".landing-schedule-tile:focus-within { transform: translateY(");
      const reduced = sheet.slice(sheet.lastIndexOf("@media (prefers-reduced-motion: reduce)"));
      expect(reduced).toMatch(/\.landing-schedule-grid \.landing-schedule-tile \{ animation: none; opacity: 1; transform: none/);
    });
  });
});
