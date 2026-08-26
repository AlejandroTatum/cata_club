import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CLUB_POSITION, clubOpenStreetMapUrl } from "@/app/landing/club-location";

/**
 * Anything shaped like a decimal map coordinate: an optional sign, digits, and
 * a fraction long enough that no spacing, ratio, or duration in this codebase
 * can be mistaken for one.
 */
const COORDINATE_LITERAL = /-?\d+\.\d{4,}/g;

/** Source text of a landing module, read from disk rather than imported. */
function landingSource(file: string): string {
  return readFileSync(path.join(process.cwd(), "src", "app", "landing", file), "utf8");
}

describe("club location", (): void => {
  it("exports one well-formed coordinate pair", (): void => {
    expect(CLUB_POSITION).toHaveLength(2);

    const [latitude, longitude] = CLUB_POSITION;
    expect(Number.isFinite(latitude)).toBe(true);
    expect(Number.isFinite(longitude)).toBe(true);
    expect(Math.abs(latitude)).toBeLessThanOrEqual(90);
    expect(Math.abs(longitude)).toBeLessThanOrEqual(180);
  });

  /**
   * The OpenStreetMap link carries the same coordinate three times — once to
   * drop the marker (`mlat`/`mlon`) and once more in the `#map` hash that
   * actually moves the viewport. A link whose marker and viewport disagree
   * sends the visitor to an empty patch of city, which is precisely the split
   * a single source has to make impossible.
   */
  it("builds every coordinate in the OpenStreetMap link from that pair", (): void => {
    const [latitude, longitude] = CLUB_POSITION;
    const url = new URL(clubOpenStreetMapUrl());

    expect(`${url.origin}${url.pathname}`).toBe("https://www.openstreetmap.org/");
    expect(url.searchParams.get("mlat")).toBe(String(latitude));
    expect(url.searchParams.get("mlon")).toBe(String(longitude));

    const [zoom, hashLatitude, hashLongitude] = url.hash.replace("#map=", "").split("/");
    expect(Number(zoom)).toBeGreaterThan(0);
    expect(Number(hashLatitude)).toBe(latitude);
    expect(Number(hashLongitude)).toBe(longitude);
  });

  /**
   * The map centre, the marker, and the external link have to read the same
   * constant. Comparing rendered output only proves they agree *today*: it
   * cannot stop the next edit from re-typing a literal into one of the three
   * and leaving the other two behind. Only the absence of a literal does.
   */
  it("leaves no coordinate literal anywhere but this module", (): void => {
    ["LandingPage.tsx", "MapCanvas.tsx"].forEach((file): void => {
      expect(landingSource(file).match(COORDINATE_LITERAL) ?? []).toEqual([]);
    });

    expect(landingSource("club-location.ts").match(COORDINATE_LITERAL) ?? []).toHaveLength(2);
  });
});
