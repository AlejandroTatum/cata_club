import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CLUB_PLUS_CODE, CLUB_POSITION, clubOpenStreetMapUrl } from "@/app/landing/club-location";

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

/** Open Location Code digits, in value order. */
const OLC_DIGITS = "23456789CFGHJMPQRVWX";

/**
 * The full code the supplied short code recovers to against Loja, Ecuador.
 * Recovery is the one step a short code cannot do alone, so the result of it
 * is pinned here and the rest of the check derives from this string.
 */
const CLUB_FULL_PLUS_CODE = "6772XQVW+J63";

/**
 * Decode an Open Location Code into the cell it names. Eleven digits resolve
 * to an area, not a point, so the decode returns bounds — asserting equality
 * against a single pair would be asserting a precision the code does not have.
 */
function decodePlusCode(code: string): { south: number; west: number; north: number; east: number } {
  const digits = code.replace("+", "");
  let south = -90;
  let west = -180;
  let latitudeSpan = 400;
  let longitudeSpan = 400;

  for (let index = 0; index < Math.min(10, digits.length); index += 2) {
    latitudeSpan /= 20;
    longitudeSpan /= 20;
    south += latitudeSpan * OLC_DIGITS.indexOf(digits[index]);
    west += longitudeSpan * OLC_DIGITS.indexOf(digits[index + 1]);
  }

  // Past ten digits the code refines through a 4-wide, 5-tall grid per digit
  // rather than another pair, which is why the two spans stop shrinking alike.
  for (const digit of digits.slice(10)) {
    const value = OLC_DIGITS.indexOf(digit);
    latitudeSpan /= 5;
    longitudeSpan /= 4;
    south += latitudeSpan * Math.floor(value / 4);
    west += longitudeSpan * (value % 4);
  }

  return { south, west, north: south + latitudeSpan, east: west + longitudeSpan };
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
   * The coordinate's authority is the Plus Code the product owner supplied
   * (#641), and the only thing that ties one to the other is arithmetic. A
   * pair typed in by hand would still render a map, still centre a marker, and
   * still pass every other test here — the decode is what catches it drifting
   * off the address it claims to be.
   */
  it("falls inside the cell the supplied Plus Code resolves to", (): void => {
    const [shortCode] = CLUB_PLUS_CODE.split(",");
    expect(CLUB_FULL_PLUS_CODE.endsWith(shortCode)).toBe(true);
    expect(landingSource("club-location.ts")).toContain(CLUB_FULL_PLUS_CODE);

    const cell = decodePlusCode(CLUB_FULL_PLUS_CODE);
    const [latitude, longitude] = CLUB_POSITION;

    expect(latitude).toBeGreaterThanOrEqual(cell.south);
    expect(latitude).toBeLessThanOrEqual(cell.north);
    expect(longitude).toBeGreaterThanOrEqual(cell.west);
    expect(longitude).toBeLessThanOrEqual(cell.east);
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
