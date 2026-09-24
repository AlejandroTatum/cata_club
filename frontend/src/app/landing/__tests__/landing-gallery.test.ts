import { describe, expect, it } from "vitest";
import {
  DEFAULT_SLIDE_ASPECT,
  GALLERY_BROWSE_HOLD_MS,
  GALLERY_SEEK_EVENT,
  SLIDE_GAP_PX,
  SLIDE_HEIGHT_BREAKPOINT,
  SLIDE_HEIGHT_DESKTOP,
  SLIDE_HEIGHT_MOBILE,
  mapGallery,
  mapGalleryEntry,
  planSlideRun,
  seekDeltaPx,
  slideWidthPx,
  type GalleryEntry,
  type PublicGalleryPayload,
} from "@/app/landing/landing-gallery";

/**
 * The gallery's data contract (issue #1372). The section used to render a
 * hand-written list of bundled photographs; it now renders only what
 * `GET /api/galeria` returns, and the gallery starts empty. These tests lock
 * the mapping between the backend payload and the cards the landing draws —
 * the one place a malformed row could become a broken image or a blank card.
 */
describe("landing gallery mapping", (): void => {
  const VALID: PublicGalleryPayload = {
    id: 1,
    titulo: "En juego",
    descripcion: "Una jugada frente al público de la sala.",
    imagenUrl: "https://res.cloudinary.com/club/foto.jpg",
  };

  it("keeps every well-formed entry, trimmed, in backend order", (): void => {
    const entries = mapGallery([VALID, { ...VALID, id: 2, titulo: "  La final  " }]);
    expect(entries).toEqual([
      { id: 1, title: "En juego", description: "Una jugada frente al público de la sala.", imageSrc: "https://res.cloudinary.com/club/foto.jpg" },
      { id: 2, title: "La final", description: "Una jugada frente al público de la sala.", imageSrc: "https://res.cloudinary.com/club/foto.jpg" },
    ]);
  });

  it("maps an empty published list to an empty gallery — the section's real initial state", (): void => {
    expect(mapGallery([])).toEqual([]);
  });

  it("maps a non-array payload to an empty gallery instead of throwing", (): void => {
    expect(mapGallery(undefined)).toEqual([]);
    expect(mapGallery({ error: "no" })).toEqual([]);
    expect(mapGallery(null)).toEqual([]);
  });

  it.each([
    ["missing id", { titulo: "t", descripcion: "d", imagenUrl: "https://cdn/f.jpg" }],
    ["non-numeric id", { id: "1", titulo: "t", descripcion: "d", imagenUrl: "https://cdn/f.jpg" }],
    ["missing title", { id: 1, descripcion: "d", imagenUrl: "https://cdn/f.jpg" }],
    ["blank title", { id: 1, titulo: "   ", descripcion: "d", imagenUrl: "https://cdn/f.jpg" }],
    ["missing description", { id: 1, titulo: "t", imagenUrl: "https://cdn/f.jpg" }],
    ["blank description", { id: 1, titulo: "t", descripcion: "", imagenUrl: "https://cdn/f.jpg" }],
    ["missing photo URL", { id: 1, titulo: "t", descripcion: "d" }],
    ["blank photo URL", { id: 1, titulo: "t", descripcion: "d", imagenUrl: "  " }],
    ["non-string photo URL", { id: 1, titulo: "t", descripcion: "d", imagenUrl: 42 }],
  ])("drops an entry with a %s", (_reason, payload): void => {
    expect(mapGalleryEntry(payload as PublicGalleryPayload)).toBeNull();
    expect(mapGallery([payload])).toEqual([]);
  });

  it("drops a malformed row without losing the well-formed ones around it", (): void => {
    const entries = mapGallery([VALID, { id: 2 }, { ...VALID, id: 3 }]);
    expect(entries.map((entry): number => entry.id)).toEqual([1, 3]);
  });

  /**
   * The title is the headline and the description is the photograph's
   * accessible description. The description rides on the image's alt text,
   * so a screen-reader user gets a description of the photograph — not just
   * the slogan above it.
   */
  it("exposes the description as the image's alt text, distinct from the title", (): void => {
    const entry = mapGalleryEntry(VALID);
    expect(entry).not.toBeNull();
    expect(entry!.description).not.toBe(entry!.title);
    expect(entry!.description.length).toBeGreaterThan(entry!.title.length);
  });
});

/**
 * The strip presents every photo at the pre-#1372 uniform height with its
 * native ratio — the geometry the motion loop measures. A drift here either
 * crops subjects (the exact rejection that sent the gallery back to the
 * strip) or silently changes the widths `planSlideRun` reasons about.
 */
describe("landing gallery slide geometry", (): void => {
  it("keeps the pre-#1372 slide heights and the swap breakpoint", (): void => {
    expect(SLIDE_HEIGHT_DESKTOP).toBe(468);
    expect(SLIDE_HEIGHT_MOBILE).toBe(340);
    expect(SLIDE_HEIGHT_BREAKPOINT).toBe(768);
  });

  it("sizes slides from the photo's native ratio at the section's fixed height", (): void => {
    expect(slideWidthPx(1.5, false)).toBe(702); // 468 * 1.5
    expect(slideWidthPx(2 / 3, false)).toBe(312); // 468 * 2/3 — portrait stays narrow
    expect(slideWidthPx(1.5, true)).toBe(510); // 340 * 1.5
  });
});

describe("landing gallery slide run planning", (): void => {
  const entry = (id: number): GalleryEntry => ({
    id,
    title: `Foto ${id}`,
    description: `Descripción ${id}`,
    imageSrc: `https://res.cloudinary.com/club/foto-${id}.jpg`,
  });
  const aspect1_5 = (): number => 1.5;

  it("repeats a catalog that is too narrow to cover the viewport, clones flagged", (): void => {
    // One landscape photo: 702px wide on desktop — far short of 1280px.
    const run = planSlideRun([entry(1)], aspect1_5, 1280, false);
    const onePass = slideWidthPx(1.5, false) + SLIDE_GAP_PX;
    expect(onePass).toBeLessThan(1280 + SLIDE_GAP_PX);
    expect(run.length).toBeGreaterThan(1);
    expect(run[0]).toEqual({ entry: entry(1), clone: false });
    expect(run.slice(1).every((slide): boolean => slide.clone)).toBe(true);
    // The planned run actually covers the viewport it was planned for.
    const covered = run.length * slideWidthPx(1.5, false) + run.length * SLIDE_GAP_PX;
    expect(covered).toBeGreaterThanOrEqual(1280 + SLIDE_GAP_PX);
  });

  it("reads each photo exactly once in the accessible sense — clones only after the full first pass", (): void => {
    const run = planSlideRun([entry(1), entry(2)], aspect1_5, 1280, false);
    expect(run.filter((slide): boolean => !slide.clone).map((slide): number => slide.entry.id)).toEqual([1, 2]);
  });

  it("leaves a catalog that already covers the viewport unrepeated", (): void => {
    const entries = [1, 2, 3, 4, 5, 6].map(entry);
    const run = planSlideRun(entries, aspect1_5, 1280, false);
    expect(run).toHaveLength(entries.length);
    expect(run.every((slide): boolean => !slide.clone)).toBe(true);
  });

  it("re-plans with the mobile height on a mobile viewport", (): void => {
    // A PORTRAIT photo on a phone: 340 * 2/3 = 227px per pass — one photo
    // cannot cover a 390px track, so the run repeats.
    const run = planSlideRun([entry(1)], (): number => 2 / 3, 390, true);
    expect(run).toHaveLength(2);
    expect(run[1].clone).toBe(true);
    const covered = run.length * Math.round(SLIDE_HEIGHT_MOBILE * (2 / 3)) + run.length * SLIDE_GAP_PX;
    expect(covered).toBeGreaterThanOrEqual(390 + SLIDE_GAP_PX);
  });

  it("answers an empty catalog with an empty run", (): void => {
    expect(planSlideRun([], aspect1_5, 1280, false)).toEqual([]);
  });

  it("falls back to the shared landscape ratio when a measurement is missing", (): void => {
    const run = planSlideRun([entry(1)], (): number => DEFAULT_SLIDE_ASPECT, 1024, false);
    expect(run.length * Math.round(468 * (3 / 2)) + run.length * SLIDE_GAP_PX).toBeGreaterThanOrEqual(1024 + SLIDE_GAP_PX);
  });
});

/**
 * The arrows must not fight the autoplay: a browse retimes the loop's own
 * timeline by exactly the travel this function computes — forward (the
 * autoplay's reading direction) for "next", backward through the seam for
 * "prev", nothing for a photo already in place. A wrong delta either misses
 * the requested photo or sends the strip the long way around the loop.
 */
describe("landing gallery browse seek math", (): void => {
  it("travels forward the short way to align the next photo", (): void => {
    expect(seekDeltaPx(100, 400, 1000, "next")).toBe(300);
    expect(seekDeltaPx(0, 500, 1000, "next")).toBe(500);
  });

  it("travels backward through the seam for the previous photo", (): void => {
    expect(seekDeltaPx(800, 300, 1000, "prev")).toBe(-500);
    // Backward wrapping: the short path crosses the seam into negative travel.
    expect(seekDeltaPx(200, 800, 1000, "prev")).toBe(-400);
  });

  it("takes the forward path through the seam when next wraps", (): void => {
    expect(seekDeltaPx(800, 200, 1000, "next")).toBe(400);
  });

  it("stays put when the requested photo is already aligned — in either direction", (): void => {
    expect(seekDeltaPx(400, 400, 1000, "next")).toBe(0);
    expect(seekDeltaPx(400, 400, 1000, "prev")).toBe(0);
  });

  it("treats a sub-pixel offset as aligned instead of travelling a full loop", (): void => {
    expect(seekDeltaPx(100, 100.4, 1000, "next")).toBe(0);
    expect(seekDeltaPx(100, 99.7, 1000, "prev")).toBe(0);
  });

  it("is exact at the half-loop boundary, where both ways cost the same", (): void => {
    expect(seekDeltaPx(0, 500, 1000, "next")).toBe(500);
    expect(seekDeltaPx(0, 500, 1000, "prev")).toBe(-500);
  });

  it("keeps the browse contract's constants honest", (): void => {
    // The event name is a public seam between Gallery and the motion runtime.
    expect(GALLERY_SEEK_EVENT).toBe("landing:gallery-seek");
    // The reading window: long enough to read a caption, short enough that
    // the marquee clearly resumes on its own.
    expect(GALLERY_BROWSE_HOLD_MS).toBe(5000);
  });
});
