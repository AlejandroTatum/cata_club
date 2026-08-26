import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/font/local", (): { __esModule: boolean; default: () => { variable: string } } => ({
  __esModule: true,
  default: (): { variable: string } => ({ variable: "mock-font" }),
}));

describe("home page metadata", (): void => {
  it("overrides the admin-panel title with club-facing copy", async (): Promise<void> => {
    const { metadata } = await import("@/app/page");

    expect(metadata.title).toEqual({ absolute: expect.stringContaining("Cata Club") });
    expect(JSON.stringify(metadata.title)).not.toMatch(/admin/i);
    expect(metadata.description).toBeTruthy();
    expect(metadata.description).not.toMatch(/administraci/i);
  });

  /**
   * The share card is a direction a visitor reads before the page even opens,
   * so it has to carry the same landmark the location copy does (#641). It
   * also must not put the club inside the Plaza de la Independencia — the
   * supplied Plus Code lands on the club's own address, not on a plaza, and no
   * source here supports that claim.
   */
  it("names the Coliseo and never places the club inside the plaza", async (): Promise<void> => {
    const { metadata } = await import("@/app/page");

    // Only the search description gives a direction. The openGraph card sells
    // the club rather than locating it, so it is held to the plaza claim only.
    expect(metadata.description).toMatch(/junto al Coliseo Ciudad de Loja/i);

    [metadata.description, metadata.openGraph?.description].forEach((copy): void => {
      expect(copy).toBeTruthy();
      expect(copy).not.toMatch(/\b(en|dentro de|interior de)\s+la\s+plaza\b/i);
    });
  });

  it("ships an openGraph card pointing at an image that exists in public/", async (): Promise<void> => {
    const { metadata } = await import("@/app/page");
    const images = metadata.openGraph?.images;

    expect(Array.isArray(images)).toBe(true);
    const [image] = images as { url: string }[];
    expect(image.url).toBeTruthy();

    const assetPath = path.join(process.cwd(), "public", image.url);
    expect(existsSync(assetPath)).toBe(true);
  });

  /**
   * A card whose declared size disagrees with the file is laid out by the
   * scraper at the wrong ratio, so the preview crops or letterboxes. Nothing
   * about that is visible from this repo — only a decode catches it.
   */
  it("declares the openGraph image at the size the file actually is", async (): Promise<void> => {
    const { metadata } = await import("@/app/page");
    const [image] = metadata.openGraph?.images as { url: string; width: number; height: number }[];

    const sharp = (await import("sharp")).default;
    const { width, height } = await sharp(path.join(process.cwd(), "public", image.url)).metadata();

    expect(width).toBe(image.width);
    expect(height).toBe(image.height);
  });
});
