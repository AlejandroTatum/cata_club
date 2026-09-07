/**
 * The club's one documented, out-of-country result — told as a short story
 * with a fact sheet, instead of a placeholder trophy wall (issue #657's
 * original `PALMARES`/`DEMO_PALMARES` table, all but one row empty). Mirrors
 * `landing-gallery.ts`'s data-module convention — plain exported constants
 * and small derivation helpers, no React involved.
 */

export interface LogroDestacado {
  /** Short label above the headline, e.g. who the athletes represented. */
  kicker: string;
  event: string;
  venue: string;
  representation: string;
  categories: string;
  /** Empty until the club supplies it — `Palmares.tsx` only renders the
   * "Año" fact when this is non-empty. Never fabricate a placeholder value. */
  year: string;
  /** Empty until the club supplies it — same rule as `year`, and for the
   * same reason: an invented placement would misrepresent a real result. */
  result: string;
  /** Bare asset name, resolved to a real path by `logroPhotoSrc`. */
  photo: string;
  story: string;
}

/** Builds the real `/landing/<name>.jpeg` path for a bare photo name. */
export function logroPhotoSrc(photo: string): string {
  return `/landing/${photo}.jpeg`;
}

/**
 * The club's one documented international result. `year` and `result` stay
 * empty on purpose — the club has not supplied either — so `Palmares.tsx`
 * renders only the four facts that are actually on file. Fill both in with
 * the real values as soon as the club supplies them; never a placeholder.
 */
export const LOGRO_DESTACADO: LogroDestacado = {
  kicker: "Selección de Ecuador",
  event: "Sudamericano Sub-11 y Sub-13",
  venue: "Asunción, Paraguay",
  representation: "Selección de Ecuador",
  categories: "Sub-11 y Sub-13",
  year: "",
  result: "",
  photo: "photo-southamerican",
  story:
    "Deportistas del club vistieron la camiseta de Ecuador en el Sudamericano Sub-11 y Sub-13 disputado en Asunción, Paraguay. Representar al país en una competencia continental es el logro más alto del club hasta hoy.",
};

/** Secondary podium photos — decorative, no captions or dates on file. */
export const MAS_PODIOS: string[] = [
  "photo-podium-home",
  "photo-podium-away",
  "photo-first-medals",
  "photo-young-medalists",
];

/** Real intrinsic dimensions for each podium photo — required by
 * `next/image` and kept here, next to the file names they describe, instead
 * of hardcoded in the component. */
export const PODIO_DIMENSIONS: Record<string, { width: number; height: number }> = {
  "photo-podium-home": { width: 750, height: 1000 },
  "photo-podium-away": { width: 750, height: 1000 },
  "photo-first-medals": { width: 626, height: 1000 },
  "photo-young-medalists": { width: 750, height: 1000 },
};
