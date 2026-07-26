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
