/** @vitest-environment jsdom */
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Sponsors, { mapSponsor, type PublicSponsorPayload } from "../Sponsors";

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

  it("shows an honest empty message when the backend returns no sponsors", async (): Promise<void> => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(jsonResponse([]));
    render(<Sponsors />);
    expect(await screen.findByText(/aún no hay auspiciantes/i)).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("handles a backend error gracefully without inventing static placeholder slots", async (): Promise<void> => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(jsonResponse({}, false));
    render(<Sponsors />);
    expect(await screen.findByText(/no se pudieron cargar los auspiciantes/i)).toBeInTheDocument();
    expect(screen.queryByText(/LOGO 0/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });
});