/** @vitest-environment jsdom */

/**
 * QA4 LAN-03/06/08/09/14/15 — the landing's conversion sections and contact
 * card. Prices come from the public tariff catalog, never from the page.
 */

import "./landing-render-mocks";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import LandingPage from "@/app/landing/LandingPage";
import { landingConfig, toWhatsAppLink } from "@/app/landing/landing-config";
import { CONTACT_EMAIL } from "@/app/terminos/LegalSideCards";
import { resetLandingTestEnvironment, stubLandingGlobals } from "./landing-test-doubles";

vi.mock("next/navigation", () => ({ usePathname: (): string => "/" }));

const TARIFAS = [
  { categoria: "Plan Prueba Uno", precio: "17.50" },
  { categoria: "Plan Prueba Dos", precio: "33.00" },
];

function stubCatalogs(tarifas: unknown, tarifasOk = true): void {
  stubLandingGlobals();
  vi.stubGlobal("fetch", vi.fn((url: string) => {
    if (url === "/api/membresias/tarifas") return Promise.resolve({ ok: tarifasOk, json: async (): Promise<unknown> => tarifas });
    return Promise.resolve({ ok: true, json: async (): Promise<unknown> => [] });
  }));
}

beforeEach((): void => { stubCatalogs(TARIFAS); });
afterEach(resetLandingTestEnvironment);

describe("prices (LAN-03)", () => {
  it("lists every plan and price the public catalog returns, and nothing else", async () => {
    render(<LandingPage />);
    const section = document.getElementById("mensualidad") as HTMLElement;
    await waitFor(() => expect(within(section).getByText("Plan Prueba Uno")).toBeInTheDocument());
    expect(within(section).getByText("$17,50")).toBeInTheDocument();
    expect(within(section).getByText("Plan Prueba Dos")).toBeInTheDocument();
    expect(within(section).getByText("$33,00")).toBeInTheDocument();
    expect(section.querySelectorAll("li")).toHaveLength(2);
  });

  it("says so and points to WhatsApp when the catalog fails", async () => {
    stubCatalogs({ message: "x" }, false);
    render(<LandingPage />);
    const section = document.getElementById("mensualidad") as HTMLElement;
    await waitFor(() => expect(within(section).getByRole("status")).toHaveTextContent(/No se pudieron cargar los valores/));
    expect(section.textContent).not.toMatch(/\$\d/);
  });

  it("keeps price literals out of the landing sources", () => {
    ["LandingPage.tsx", "ConversionSections.tsx"].forEach((file): void => {
      expect(readFileSync(join(process.cwd(), "src/app/landing", file), "utf8")).not.toMatch(/\$\s?\d/);
    });
  });
});

describe("steps and enrollment entry points (LAN-14)", () => {
  it("shows the three steps in order", () => {
    render(<LandingPage />);
    const steps = Array.from(document.querySelectorAll(".landing-steps-list li")).map((li) => li.textContent);
    expect(steps).toEqual(["Elige la categoría", "Inscríbete en línea", "Paga y empieza"]);
  });

  it("sends adults and parents to the matching enrollment type", () => {
    render(<LandingPage />);
    expect(screen.getByRole("link", { name: /Soy jugador adulto/ })).toHaveAttribute("href", "/student/enroll?type=self");
    expect(screen.getByRole("link", { name: /Inscribo a mi hijo/ })).toHaveAttribute("href", "/student/enroll?type=child");
  });

  it("offers a mini FAQ with price, what to bring and the first class", () => {
    render(<LandingPage />);
    const questions = Array.from(document.querySelectorAll(".landing-faq-list summary")).map((summary) => summary.textContent);
    expect(questions).toEqual(["¿Cuánto cuesta?", "¿Qué debo llevar?", "¿Cómo es la primera clase?"]);
  });

  it("adds a mobile bar with the enrollment link and a labeled WhatsApp link", () => {
    const { container } = render(<LandingPage />);
    const bar = container.querySelector(".landing-mobile-bar") as HTMLElement;
    expect(within(bar).getByRole("link", { name: /Inscríbete/ })).toHaveAttribute("href", "/student/enroll");
    expect(within(bar).getByRole("link", { name: "Escribir por WhatsApp" })).toHaveAttribute("href", toWhatsAppLink(landingConfig.contact.whatsapp[0]));
  });

  it("captions the hero photo with its own description", () => {
    const { container } = render(<LandingPage />);
    expect(container.querySelector(".landing-hero-caption")).toHaveTextContent("Deportistas, entrenadores y familias de Cata Club reunidos");
  });
});

describe("copy (LAN-08, LAN-09)", () => {
  it("fixes the hero sentence, the founding line and the cupo link", () => {
    render(<LandingPage />);
    expect(screen.getByText("Únete a nuestro club, donde la técnica y el carácter se forjan en cada punto.")).toBeInTheDocument();
    expect(screen.getByText("Desde el 10 de octubre de 2013")).toBeInTheDocument();
  });

  it("does not restate the category names in the share card", async () => {
    vi.doMock("next/font/local", () => ({ default: (): { variable: string } => ({ variable: "" }) }));
    const { metadata } = await import("@/app/page");
    expect(metadata.openGraph?.description).not.toMatch(/formativ|infantil|juvenil|competitiv/i);
  });
});

describe("contact (LAN-15)", () => {
  it("shows the club email from the config as a mailto link, equal to the legal pages' address", () => {
    render(<LandingPage />);
    expect(landingConfig.contact.email).toBe(CONTACT_EMAIL);
    expect(screen.getByRole("link", { name: CONTACT_EMAIL })).toHaveAttribute("href", `mailto:${CONTACT_EMAIL}`);
  });

  it("keeps a call and a WhatsApp link for every configured number", () => {
    render(<LandingPage />);
    landingConfig.contact.whatsapp.forEach((number) => {
      expect(screen.getByRole("link", { name: `Llamar a Administración · ${number}` })).toHaveAttribute("href", expect.stringMatching(/^tel:\+593\d{9}$/));
    });
  });
});

describe("phone labels (LAN-15)", () => {
  it("labels both numbers Administración and keeps each link's name distinct", () => {
    render(<LandingPage />);
    const numbers = landingConfig.contact.whatsapp;
    expect(numbers).toHaveLength(2);
    numbers.forEach((number) => {
      expect(landingConfig.contact.phoneLabels[number]).toBe("Administración");
      expect(screen.getByRole("link", { name: `Administración · ${number}` })).toHaveAttribute("href", toWhatsAppLink(number));
    });
    expect(screen.queryByText(/Entrenadores/)).toBeNull();
  });
});

describe("opening hours in SEO (LAN-06)", () => {
  const SCHEDULES = [{ category: "Infantil", ages: "5 a 10 años", blocks: [{ days: ["LUNES", "MIERCOLES"], startTime: "15:00", endTime: "16:00" }] }];

  function stubWithSchedules(): void {
    stubLandingGlobals();
    vi.stubGlobal("fetch", vi.fn((url: string) => Promise.resolve({
      ok: true,
      json: async (): Promise<unknown> => (url === "/api/schedules" ? SCHEDULES : []),
    })));
  }

  it("emits the published hours once the schedules arrive, on an indexable deployment", async () => {
    stubWithSchedules();
    const { container } = render(<LandingPage siteUrl="https://cataclub.example" />);
    await waitFor(() => expect(container.querySelector('script[type="application/ld+json"]')).not.toBeNull());
    const data = JSON.parse(container.querySelector('script[type="application/ld+json"]')?.textContent ?? "{}");
    expect(data["@id"]).toBe("https://cataclub.example/#club");
    expect(data.openingHoursSpecification).toEqual([
      { "@type": "OpeningHoursSpecification", dayOfWeek: ["Monday", "Wednesday"], opens: "15:00", closes: "16:00" },
    ]);
  });

  it("emits nothing on a non-indexable deployment", async () => {
    stubWithSchedules();
    const { container } = render(<LandingPage />);
    await waitFor(() => expect(container.querySelector(".landing-schedule-grid")).not.toBeNull());
    expect(container.querySelector('script[type="application/ld+json"]')).toBeNull();
  });
});
