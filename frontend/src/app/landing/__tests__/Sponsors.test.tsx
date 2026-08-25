/** @vitest-environment jsdom */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Sponsors, { mapSponsor, type PublicSponsorPayload } from "../Sponsors";

// The colour/section rhythm lives in CSS that jsdom cannot compute, so the
// style guards read the authored stylesheet and pin the exact token-backed
// contract issues #611 sets out.
const landingCss = (): string =>
  readFileSync(resolve(process.cwd(), "src/app/landing/landing.css"), "utf8");

const jsonResponse = (body: unknown, ok = true): { ok: boolean; status?: number; json: () => Promise<unknown> } =>
  ({ ok, status: ok ? 200 : 503, json: async () => body });

describe("Sponsors", (): void => {
  beforeEach((): void => { vi.stubGlobal("fetch", vi.fn()); });
  afterEach((): void => { vi.unstubAllGlobals(); });

  it("maps backend camelCase records (id/nombre/logoUrl), preserving the id and dropping unusable records", (): void => {
    expect(mapSponsor({ id: 1, nombre: "Municipio", logoUrl: "https://cdn/logo.png" }))
      .toEqual({ id: 1, name: "Municipio", logoSrc: "https://cdn/logo.png" });
    expect(mapSponsor({ id: 2, nombre: "   ", logoUrl: "https://cdn/x.png" })).toBeNull();
    expect(mapSponsor({ id: 3, nombre: "X", logoUrl: "" })).toBeNull();
    expect(mapSponsor({ id: 4 })).toBeNull();
    // The backend always sends a numeric id; a record without one is not part
    // of the accepted contract and must not render a key-less logo.
    expect(mapSponsor({ nombre: "Y", logoUrl: "https://cdn/y.png" })).toBeNull();
    expect(mapSponsor({ id: "abc", nombre: "Y", logoUrl: "https://cdn/y.png" })).toBeNull();
    // The backend ResponseBase alias generator serializes snake_case fields as
    // camelCase (logo_url -> logoUrl), so a snake_case-only record is not part
    // of the accepted contract and must not silently half-map.
    expect(mapSponsor({ id: 5, nombre: "Y", logo_url: "https://cdn/y.png" } as unknown as PublicSponsorPayload)).toBeNull();
  });

  it("keeps two same-name sponsors as separate logos via stable id-based keys", async (): Promise<void> => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(jsonResponse([
      { id: 1, nombre: "Municipio", logoUrl: "https://cdn/muni-a.png" },
      { id: 2, nombre: "Municipio", logoUrl: "https://cdn/muni-b.png" },
    ]));
    render(<Sponsors />);
    // One logo per record per copy: the duplicated marquee doubles it to four
    // <img> elements with that alt. Name-based keys would collide and collapse
    // one of the two records, yielding two instead of four.
    expect(await screen.findAllByAltText("Municipio")).toHaveLength(4);
  });

  it("renders real sponsor logos as plain <img> with the raw Cloudinary URL — never a /_next/image optimizer URL", async (): Promise<void> => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(jsonResponse([
      { id: 1, nombre: "Municipio", logoUrl: "https://res.cloudinary.com/cata-club/image/upload/v1/logos/muni.png" },
      { id: 2, nombre: "FedeLoja", logoUrl: "https://cdn/fedeloja.png" },
    ]));
    render(<Sponsors />);
    const mun = await screen.findAllByAltText("Municipio");
    expect(mun).toHaveLength(2);
    for (const logo of mun) {
      // Same convention as AppShell's avatar / /profile's IdentityPanel: external
      // Cloudinary URLs render as a plain <img>, so the logo never hits Next's
      // image optimizer (which 400s for hosts absent from images.remotePatterns).
      expect(logo.tagName).toBe("IMG");
      expect(logo.getAttribute("src")).toBe("https://res.cloudinary.com/cata-club/image/upload/v1/logos/muni.png");
      expect(logo.getAttribute("src")).not.toContain("/_next/image");
    }
    expect(screen.getAllByAltText("FedeLoja")).toHaveLength(2);
    expect(global.fetch).toHaveBeenCalledWith("/api/sponsors", expect.any(Object));
    expect(screen.queryByText(/pendientes de confirmación/i)).not.toBeInTheDocument();
  });

  it("uses the canonical 'Patrocinadores' label for the strip, its ready status, and its states", async (): Promise<void> => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(jsonResponse([
      { id: 1, nombre: "Municipio", logoUrl: "https://cdn/muni.png" },
    ]));
    render(<Sponsors />);
    // The ready-status only exists once the fetch resolved, so awaiting it is
    // what actually waits for the data: the header renders in every state, so
    // awaiting that first would pass during loading and race the assertion below.
    expect(await screen.findByText(/^Patrocinadores:/i)).toBeInTheDocument();
    // The strip header is the canonical public term, not "Nos acompañan".
    expect(screen.getByText("Patrocinadores")).toBeInTheDocument();
    expect(screen.queryByText(/Auspiciantes|Nos acompañan/i)).not.toBeInTheDocument();
  });

  it("renders each sponsor logo at ~double the previous size while preserving aspect via contain", async (): Promise<void> => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(jsonResponse([
      { id: 1, nombre: "Municipio", logoUrl: "https://cdn/muni.png" },
    ]));
    render(<Sponsors />);
    const [logo] = await screen.findAllByAltText("Municipio");
    // The rendered logo grows from 156x60 to ~312x120 (issue #611).
    expect(logo.getAttribute("width")).toBe("312");
    expect(logo.getAttribute("height")).toBe("120");
  });

  it("keeps sponsor logos in full colour with contained sizing — no grayscale/dim, no dead href-hover restore", (): void => {
    const css = landingCss();
    const imgRule = css.match(/\.landing-sponsor img \{[\s\S]*?\}/)?.[0] ?? "";
    expect(imgRule).toContain("object-fit: contain");
    expect(imgRule).not.toMatch(/grayscale|opacity/);
    // Sponsors are not links; the old `[href]:hover` colour restore must go.
    expect(css).not.toMatch(/\.landing-sponsor\[href\]/);
  });

  it("doubles the sponsor card geometry (item width and tile height)", (): void => {
    const css = landingCss();
    const itemRule = css.match(/\.landing-sponsors-item \{[\s\S]*?\}/)?.[0] ?? "";
    const sponsorRule = css.match(/\.landing-sponsor \{[\s\S]*?\}/)?.[0] ?? "";
    expect(itemRule).toMatch(/clamp\(300px/);
    expect(sponsorRule).toMatch(/height: 168px/);
  });

  it("applies the section colour rhythm from brand tokens (Horarios white, Misión/Visión black, Valores yellow)", (): void => {
    const css = landingCss();
    expect(css).toMatch(/\.landing-schedule \{[^}]*var\(--landing-surface\)/);
    expect(css).toMatch(/\.landing-section#nosotros \{[^}]*var\(--landing-footer\)/);
    expect(css).toMatch(/\.landing-values \{[^}]*var\(--landing-highlight\)/);
  });

  it("shows an honest empty message when the backend returns no sponsors", async (): Promise<void> => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(jsonResponse([]));
    render(<Sponsors />);
    expect(await screen.findByText(/aún no hay patrocinadores/i)).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("handles a backend error gracefully without inventing static placeholder slots", async (): Promise<void> => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(jsonResponse({}, false));
    render(<Sponsors />);
    expect(await screen.findByText(/no se pudieron cargar los patrocinadores/i)).toBeInTheDocument();
    expect(screen.queryByText(/LOGO 0/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });
});