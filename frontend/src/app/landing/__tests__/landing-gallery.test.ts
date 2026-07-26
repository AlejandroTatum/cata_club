import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  GALLERY_PHOTOS,
  SLIDE_HEIGHT_BREAKPOINT,
  SLIDE_HEIGHT_DESKTOP,
  SLIDE_HEIGHT_MOBILE,
  slideSizes,
} from "@/app/landing/landing-gallery";

describe("landing gallery photos", (): void => {
  it("publishes enough photos for the carousel to loop without visible repetition", (): void => {
    // The strip is seamless: with too few frames the same photo is on screen
    // twice at once on a wide viewport, which reads as a rendering fault.
    expect(GALLERY_PHOTOS.length).toBeGreaterThanOrEqual(8);
  });

  it("points every photo at its own distinct asset", (): void => {
    const sources = GALLERY_PHOTOS.map((photo): string => photo.src);
    expect(new Set(sources).size).toBe(sources.length);
  });

  it("serves every photo from the landing asset directory", (): void => {
    GALLERY_PHOTOS.forEach((photo): void => {
      expect(photo.src).toMatch(/^\/landing\/[\w-]+\.jpeg$/);
    });
  });

  /**
   * The caption is the story and the alt text is the description. Letting them
   * collapse into one string leaves a screen-reader user with a slogan where a
   * description of the photograph belongs.
   */
  it("describes each photo separately from the caption it displays", (): void => {
    GALLERY_PHOTOS.forEach((photo): void => {
      expect(photo.alt.length).toBeGreaterThan(photo.caption.length);
      expect(photo.alt).not.toBe(photo.caption);
    });
  });

  /**
   * Every regression this file guards is the same one: `sizes` states a WIDTH,
   * and the browser picks a file from it before any stylesheet has applied. If
   * the stated width is smaller than the rendered one — because the numbers
   * drifted from the CSS, or because the box is a different shape than the
   * photo and `object-fit: cover` binds on height instead — it downloads a file
   * too small and scales it up. That is invisible in review and obvious on a
   * phone. One landing photo shipped upscaled 2.23x this way.
   */
  it("exports every photo at one uniform height so width alone drives the layout", (): void => {
    const heights = new Set(GALLERY_PHOTOS.map((photo): number => photo.height));
    expect(heights.size).toBe(1);
  });

  it("carries enough pixels for the tallest rendered slide at 2x", (): void => {
    GALLERY_PHOTOS.forEach((photo): void => {
      expect(photo.height).toBeGreaterThanOrEqual(SLIDE_HEIGHT_DESKTOP * 2);
    });
  });

  it("states each photo's real rendered width at both breakpoints", (): void => {
    const photo = GALLERY_PHOTOS[0];
    const aspect = photo.width / photo.height;
    expect(slideSizes(photo)).toBe(
      `(max-width: ${SLIDE_HEIGHT_BREAKPOINT}px) ${Math.round(SLIDE_HEIGHT_MOBILE * aspect)}px, ${Math.round(SLIDE_HEIGHT_DESKTOP * aspect)}px`,
    );
  });

  /**
   * `sizes` cannot read CSS, so these numbers are duplicated by necessity. This
   * is the only thing standing between that duplication and silent drift.
   */
  it("keeps the slide heights in step with the stylesheet", (): void => {
    const css = readFileSync(path.join(process.cwd(), "src/app/landing/landing.css"), "utf8");

    expect(css).toMatch(new RegExp(`--landing-slide-height:\\s*${SLIDE_HEIGHT_DESKTOP}px`));
    const mobileBlock = css.slice(css.indexOf(`@media (max-width: ${SLIDE_HEIGHT_BREAKPOINT}px)`));
    expect(mobileBlock).toMatch(new RegExp(`--landing-slide-height:\\s*${SLIDE_HEIGHT_MOBILE}px`));
  });

  /**
   * The declared size is what `sizes` and the slide width are computed from.
   * Re-export an asset at a different size without updating this file and the
   * whole chain is wrong while every other test still passes.
   */
  it("declares each photo at the size its file actually is", async (): Promise<void> => {
    const sharp = (await import("sharp")).default;

    await Promise.all(GALLERY_PHOTOS.map(async (photo): Promise<void> => {
      const { width, height } = await sharp(path.join(process.cwd(), "public", photo.src)).metadata();
      expect({ src: photo.src, width, height })
        .toEqual({ src: photo.src, width: photo.width, height: photo.height });
    }));
  });

  it("keeps the championship specifics on the photo that shows them", (): void => {
    const championship = GALLERY_PHOTOS.find((photo): boolean => /Sudamericano/i.test(photo.caption));
    expect(championship).toBeDefined();
    expect(championship?.caption).toMatch(/Asunción/);
  });
});
