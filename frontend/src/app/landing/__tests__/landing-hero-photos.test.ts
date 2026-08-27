/** @vitest-environment node */

import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { HERO_PHOTOS } from "@/app/landing/landing-hero-photos";

/**
 * Lock — issue #729: the hero sources must stay compressed.
 *
 * Measured on `main` @ `97ae590`, after PR #728 had served the gallery
 * thumbnails at their rendered width, these three were the heaviest assets on
 * the landing page: 793,531 / 646,402 / 788,456 bytes, 2,228,389 in total.
 *
 * Two assertions, and the second is the one that matters. A weight ceiling on
 * its own can be satisfied by simply shrinking the photo, and these are the
 * hero's own sources: slide 01 carries `priority` and is in the LCP path, so
 * a smaller source would trade page weight for a soft first impression. The
 * dimensions are therefore pinned alongside the ceiling — the only way to
 * satisfy both is to compress, which is what was actually done (mozjpeg q92,
 * unchanged dimensions, 47.6-48.3 dB PSNR at render scale).
 *
 * The ceiling is deliberately close to what the current files weigh. A new
 * hero photo dropped in straight from a phone will trip it, and that is the
 * intent: the compression step is not optional for this slot.
 */
const PUBLIC_DIR = join(process.cwd(), "public");
const MAX_HERO_BYTES = 600 * 1024;

/** Pinned from the sources as shipped. Recompression must not resize them. */
const EXPECTED_DIMENSIONS: Record<string, { width: number; height: number }> = {
  "/landing/hero-community.jpg": { width: 2048, height: 1536 },
  "/landing/hero-competition.jpg": { width: 1536, height: 2048 },
  "/landing/hero-training.jpg": { width: 2048, height: 1536 },
};

/**
 * Reads a baseline JPEG's frame size straight out of its SOF marker. Small
 * enough to keep this suite free of an image decoder, and it doubles as a
 * check that the file is still a well-formed JPEG at all.
 */
function readJpegSize(bytes: Buffer): { width: number; height: number } {
  expect(bytes.readUInt16BE(0)).toBe(0xffd8); // SOI
  let offset = 2;
  while (offset < bytes.length) {
    expect(bytes[offset]).toBe(0xff);
    const marker = bytes[offset + 1];
    const length = bytes.readUInt16BE(offset + 2);
    // SOF0/1/2/3 and SOF9/10/11 carry the frame dimensions; SOF4 (0xc4) and
    // SOF8 (0xc8) are DHT/JPG and must be skipped.
    const isStartOfFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isStartOfFrame) {
      return { height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7) };
    }
    offset += 2 + length;
  }
  throw new Error("no SOF marker found");
}

describe("landing hero photo sources", (): void => {
  it("lists exactly the three carousel photos", (): void => {
    expect(HERO_PHOTOS.map((photo): string => photo.src)).toEqual(Object.keys(EXPECTED_DIMENSIONS));
  });

  it.each(HERO_PHOTOS.map((photo): string => photo.src))(
    "%s stays under the hero weight ceiling at its full dimensions",
    (src: string): void => {
      const path = join(PUBLIC_DIR, src);
      const size = statSync(path).size;

      expect(size).toBeLessThanOrEqual(MAX_HERO_BYTES);
      expect(readJpegSize(readFileSync(path))).toEqual(EXPECTED_DIMENSIONS[src]);
    },
  );

  it("keeps the whole hero set under 1.7MB on disk", (): void => {
    const total = HERO_PHOTOS.reduce(
      (sum, photo): number => sum + statSync(join(PUBLIC_DIR, photo.src)).size,
      0,
    );

    // 2,228,389 before; the ceiling would have been blown by any two of them.
    expect(total).toBeLessThanOrEqual(1.7 * 1024 * 1024);
  });
});
