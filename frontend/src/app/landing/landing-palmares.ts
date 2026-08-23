/**
 * The club's palmarés (competitive record): year, medal, competition, and
 * venue, each backed by a photo. Mirrors `landing-gallery.ts`'s data-module
 * convention — plain exported constants and small derivation helpers, no
 * React involved.
 */

/** `""` marks a field the club has not supplied yet — never a real medal. */
export type PalmaresMedal = "oro" | "plata" | "bronce" | "part" | "";

export interface PalmaresRow {
  year: string;
  medal: PalmaresMedal;
  event: string;
  venue: string;
  /** Bare asset name, resolved to a real path by `palmaresPhotoSrc` — kept
   * bare here so this module stays a plain data table, the same way
   * `landing-gallery.ts`'s photos carry their real `src` instead. */
  photo: string;
}

/** Builds the real `/landing/<name>.jpeg` path for a row's bare photo name. */
export function palmaresPhotoSrc(photo: string): string {
  return `/landing/${photo}.jpeg`;
}

/** Human label for a medal. `part` (participación) intentionally has no
 * color treatment in the UI — see `Palmares.tsx` — it is not a medal. */
export const MEDAL_LABELS: Record<Exclude<PalmaresMedal, "">, string> = {
  oro: "Oro",
  plata: "Plata",
  bronce: "Bronce",
  part: "Participación",
};

/**
 * A row only counts as documented once every field is filled in. A single
 * empty field — including a real row missing just its year or medal — keeps
 * it in the "pending" visual state: the photo alone is not proof of a result
 * without the year, placement, and venue to back it up.
 */
export function isPalmaresRowComplete(row: PalmaresRow): boolean {
  return row.year !== "" && row.medal !== "" && row.event !== "" && row.venue !== "";
}

/** The club's real, documented record — what a visitor sees by default. Only
 * the Sudamericano is on file, and even that row is missing year/placement;
 * the rest are placeholder rows the club still needs to supply. */
export const PALMARES: PalmaresRow[] = [
  { year: "", medal: "", event: "Sudamericano Sub-11 y Sub-13", venue: "Asunción, Paraguay · con el uniforme de Ecuador", photo: "photo-southamerican" },
  { year: "", medal: "", event: "", venue: "", photo: "photo-podium-home" },
  { year: "", medal: "", event: "", venue: "", photo: "photo-podium-away" },
  { year: "", medal: "", event: "", venue: "", photo: "photo-first-medals" },
  { year: "", medal: "", event: "", venue: "", photo: "photo-young-medalists" },
];

/** Fabricated for layout/sizing judgment only. NEVER the default render;
 * the off-by-default demo toggle shows a real warning when switched on. */
export const DEMO_PALMARES: PalmaresRow[] = [
  { year: "2024", medal: "oro", event: "Sudamericano Sub-11 y Sub-13", venue: "Asunción, Paraguay · con el uniforme de Ecuador", photo: "photo-southamerican" },
  { year: "2024", medal: "plata", event: "Campeonato Nacional Interclubes", venue: "Quito · categoría Juvenil", photo: "photo-podium-away" },
  { year: "2023", medal: "oro", event: "Campeonato Provincial de Loja", venue: "Loja · categorías Formativa e Infantil", photo: "photo-podium-home" },
  { year: "2023", medal: "bronce", event: "Juegos Nacionales Juveniles", venue: "Guayaquil · equipos", photo: "photo-first-medals" },
  { year: "2022", medal: "part", event: "Torneo Apertura Zona Sur", venue: "Loja · debut de la categoría Formativa", photo: "photo-young-medalists" },
];
