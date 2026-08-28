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

// The marquee contract of issue #765, stated here independently of how
// Sponsors.tsx implements it: one copy of the strip must carry enough real
// tiles to outrun the widest viewport it targets (a 4K desktop), so the
// `min-width: 100vw` that keeps the loop continuous has no leftover width to
// place anywhere. The tile span is the widest a tile plus its gap can get —
// pinned against the stylesheet below, since these numbers only mean anything
// while the CSS still declares them.
const MAX_VIEWPORT_PX = 3840;
const MAX_TILE_PX = 416;
const SPONSOR_GAP_PX = 18;
const TILES_PER_COPY = Math.ceil(MAX_VIEWPORT_PX / (MAX_TILE_PX + SPONSOR_GAP_PX));
const expectedRepetitions = (sponsors: number): number => Math.ceil(TILES_PER_COPY / sponsors);

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
    // Both records survive as separate logos: name-based keys would collide and
    // collapse one of the two. Counted through the accessibility tree, which
    // sees one pass of the roster however many times the marquee repeats it.
    const logos = await screen.findAllByAltText("Municipio");
    expect(screen.getAllByRole("img", { name: "Municipio" })).toHaveLength(2);
    expect(new Set(logos.map((logo): string | null => logo.getAttribute("src"))))
      .toEqual(new Set(["https://cdn/muni-a.png", "https://cdn/muni-b.png"]));
  });

  it("renders real sponsor logos as plain <img> with the raw Cloudinary URL — never a /_next/image optimizer URL", async (): Promise<void> => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(jsonResponse([
      { id: 1, nombre: "Municipio", logoUrl: "https://res.cloudinary.com/cata-club/image/upload/v1/logos/muni.png" },
      { id: 2, nombre: "FedeLoja", logoUrl: "https://cdn/fedeloja.png" },
    ]));
    render(<Sponsors />);
    const mun = await screen.findAllByAltText("Municipio");
    // One accessible logo per record; the rest of the tiles are repeats the
    // marquee needs to span the screen, and every one of them is a plain <img>.
    expect(screen.getAllByRole("img", { name: "Municipio" })).toHaveLength(1);
    for (const logo of mun) {
      // Same convention as AppShell's avatar / /profile's IdentityPanel: external
      // Cloudinary URLs render as a plain <img>, so the logo never hits Next's
      // image optimizer (which 400s for hosts absent from images.remotePatterns).
      expect(logo.tagName).toBe("IMG");
      expect(logo.getAttribute("src")).toBe("https://res.cloudinary.com/cata-club/image/upload/v1/logos/muni.png");
      expect(logo.getAttribute("src")).not.toContain("/_next/image");
    }
    expect(screen.getAllByRole("img", { name: "FedeLoja" })).toHaveLength(1);
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

  // What follows can prove the marquee's *declared* geometry and its DOM
  // arithmetic, and nothing else: jsdom performs no layout, so no test here can
  // measure a rendered gap, a copy's width, or the moment the loop recycles.
  // The stylesheet guard proves the copy rule can no longer hand leftover width
  // to the gaps; the DOM guards prove one copy carries enough tiles to outrun
  // the widest viewport and that the copy count still matches the keyframe.
  // The resulting pixels are only provable in a browser — tests/e2e/landing.spec.ts.
  it("never hands the copy's leftover width to the gaps between logos", (): void => {
    const css = landingCss();
    const [copyRule = "", ...gapOverrides] = css.match(/\.landing-sponsors-copy \{[\s\S]*?\}/g) ?? [];
    // `space-between` (or its siblings) is exactly what turned a copy wider than
    // its content into ~327px of air between three logos (issue #765).
    expect(copyRule).not.toMatch(/justify-content:\s*space-(between|around|evenly)/);
    // The copy still spans the viewport: that is what keeps the following copy
    // under the viewport when this one reaches its repeat boundary.
    expect(copyRule).toContain("min-width: 100vw");
    expect(copyRule).toContain(`--landing-sponsor-gap: ${SPONSOR_GAP_PX}px`);
    expect(copyRule).toContain("gap: var(--landing-sponsor-gap)");
    // The two @media rules that retune the gap keep doing only that.
    expect(gapOverrides).toHaveLength(2);
    for (const override of gapOverrides) expect(override).toMatch(/^\.landing-sponsors-copy \{ --landing-sponsor-gap: \d+px; \}$/);
  });

  it("keeps the tile span the repetition count is calculated from", (): void => {
    const itemRule = landingCss().match(/\.landing-sponsors-item \{[\s\S]*?\}/)?.[0] ?? "";
    // The repetition count above assumes a tile never exceeds MAX_TILE_PX; a
    // wider tile would need more repetitions to still outrun the viewport.
    expect(itemRule).toContain(`clamp(300px, 30vw, ${MAX_TILE_PX}px)`);
  });

  it("repeats the sponsor list inside each copy until one copy outruns the widest viewport", async (): Promise<void> => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(jsonResponse([
      { id: 1, nombre: "Municipio", logoUrl: "https://cdn/muni.png" },
    ]));
    render(<Sponsors />);
    // A single sponsor is the worst case: one list is 434px against a 3840px
    // viewport, so the copy has to repeat it before `min-width: 100vw` is asked
    // to invent the difference.
    const repetitions = expectedRepetitions(1);
    expect((await screen.findAllByAltText("Municipio"))).toHaveLength(2 * repetitions);
    expect(repetitions * (MAX_TILE_PX + SPONSOR_GAP_PX)).toBeGreaterThanOrEqual(MAX_VIEWPORT_PX);
  });

  it("scales the repetitions down as sponsors are added, keeping the track bounded", async (): Promise<void> => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(jsonResponse([
      { id: 1, nombre: "Municipio", logoUrl: "https://cdn/muni.png" },
      { id: 2, nombre: "FedeLoja", logoUrl: "https://cdn/fedeloja.png" },
      { id: 3, nombre: "Cata", logoUrl: "https://cdn/cata.png" },
    ]));
    const { container } = render(<Sponsors />);
    await screen.findAllByAltText("Municipio");
    const tiles = container.querySelectorAll(".landing-sponsors-item");
    // Three sponsors need fewer repetitions than one, so the DOM never grows
    // with the sponsor count beyond the viewport it has to cover.
    expect(tiles).toHaveLength(2 * 3 * expectedRepetitions(3));
    expect(3 * expectedRepetitions(3) * (MAX_TILE_PX + SPONSOR_GAP_PX)).toBeGreaterThanOrEqual(MAX_VIEWPORT_PX);
  });

  it("keeps the two-copy track in step with the -50% keyframe", async (): Promise<void> => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(jsonResponse([
      { id: 1, nombre: "Municipio", logoUrl: "https://cdn/muni.png" },
    ]));
    const { container } = render(<Sponsors />);
    await screen.findAllByAltText("Municipio");
    // Two equal copies are what makes -50% exactly one copy width. Changing one
    // without the other makes the marquee jump on every loop.
    expect(container.querySelectorAll(".landing-sponsors-track > .landing-sponsors-copy")).toHaveLength(2);
    expect(landingCss()).toMatch(/@keyframes landing-sponsors-marquee \{ to \{ transform: translateX\(-50%\); \} \}/);
  });

  it("announces each sponsor logo once however many times the marquee repeats it", async (): Promise<void> => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(jsonResponse([
      { id: 1, nombre: "Municipio", logoUrl: "https://cdn/muni.png" },
      { id: 2, nombre: "FedeLoja", logoUrl: "https://cdn/fedeloja.png" },
    ]));
    render(<Sponsors />);
    await screen.findAllByAltText("Municipio");
    // Every tile past the first pass is hidden from the accessibility tree, so
    // a screen reader hears the roster once no matter how wide the strip is.
    expect(screen.getAllByRole("img", { name: "Municipio" })).toHaveLength(1);
    expect(screen.getAllByRole("img", { name: "FedeLoja" })).toHaveLength(1);
    expect(screen.getAllByAltText("Municipio").length).toBeGreaterThan(1);
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