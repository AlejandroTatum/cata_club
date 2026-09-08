/** Competition-grouped achievements for the public Logros carousel.
 *
 * The inventory below is intentionally limited to institutional results supplied
 * for the landing page. Missing venue, category, athlete, or placement details
 * stay out instead of being completed with certificate-only information.
 */

export interface AchievementGroup {
  id: string;
  label: string;
  kicker: string;
  title: string;
  competition: string;
  story: string;
  year: string;
  venue?: string;
  category?: string;
  athletes?: string;
  result: string;
  photo: string;
}

export function logroPhotoSrc(photo: string): string {
  return `/landing/${photo}.jpeg`;
}

export const ACHIEVEMENT_GROUPS: AchievementGroup[] = [
  {
    id: "south-american-doubles-2026",
    label: "2026 · Sudamericano",
    kicker: "Sudamericano · Asunción",
    title: "Bronce sudamericano en dobles",
    competition: "Sudamericano",
    story: "Eleana Ochoa y Dana Palma alcanzaron la medalla de bronce en dobles en el Sudamericano disputado en Asunción, Paraguay.",
    year: "2026",
    venue: "Asunción, Paraguay",
    athletes: "Eleana Ochoa y Dana Palma",
    result: "Medalla de bronce en dobles",
    photo: "photo-southamerican",
  },
  {
    id: "south-american-qualifiers-2025",
    label: "Clasificados al Sudamericano",
    kicker: "Clasificados al Sudamericano · 2025",
    title: "Clasificados al Sudamericano",
    competition: "Sudamericano",
    story: "Eleana Ochoa, Sebastián Paladines, Taylor González e Isabella Minga obtuvieron la clasificación para los eventos sudamericanos de 2025, según el inventario institucional.",
    year: "2025",
    athletes: "Eleana Ochoa, Sebastián Paladines, Taylor González e Isabella Minga",
    result: "Clasificación para eventos sudamericanos",
    photo: "photo-podium-home",
  },
  {
    id: "pan-american-qualifiers-2025",
    label: "Clasificados al Panamericano",
    kicker: "Clasificados al Panamericano · 2025",
    title: "Clasificados al Panamericano",
    competition: "Panamericano",
    story: "Sebastián Paladines y Taylor González obtuvieron la clasificación para los eventos panamericanos de 2025 en Guatemala.",
    year: "2025",
    venue: "Guatemala",
    athletes: "Sebastián Paladines y Taylor González",
    result: "Clasificación para eventos panamericanos",
    photo: "photo-podium-away",
  },
  {
    id: "national-selective-cuenca-2024",
    label: "Selectiva Nacional · Cuenca",
    kicker: "Selectiva Nacional · Cuenca",
    title: "Siete colocaciones en Cuenca",
    competition: "Selectiva Nacional",
    story: "La selectiva nacional de Cuenca, en la categoría 10–12, registra siete colocaciones en el inventario institucional de resultados.",
    year: "2024",
    venue: "Cuenca",
    category: "10–12",
    result: "Siete colocaciones",
    photo: "photo-first-medals",
  },
  {
    id: "national-selective-pichincha-2024",
    label: "Selectiva Nacional · Pichincha",
    kicker: "Selectiva Nacional · Pichincha",
    title: "Bronce por equipos",
    competition: "Selectiva Nacional",
    story: "La selectiva nacional de Pichincha, en la categoría 14–18, registra un equipo medallista de bronce.",
    year: "2024",
    venue: "Pichincha",
    category: "14–18",
    result: "Equipo medallista de bronce",
    photo: "photo-young-medalists",
  },
  {
    id: "europe-world-circuit-2019",
    label: "Circuito europeo y mundial",
    kicker: "Circuito europeo y mundial",
    title: "Participación internacional",
    competition: "Circuito europeo y mundial",
    story: "El inventario institucional registra participación en el circuito europeo y mundial durante 2019.",
    year: "2019",
    result: "Participación en circuito europeo y mundial",
    photo: "photo-community",
  },
  {
    id: "national-podiums-2017-2019",
    label: "2017–2019 · Nacional",
    kicker: "Competencias nacionales",
    title: "Podios nacionales",
    competition: "Competencias nacionales",
    story: "Las competencias nacionales con podio registradas entre 2017 y 2019 forman parte de la historia deportiva institucional del club.",
    year: "2017–2019",
    result: "Podios nacionales",
    photo: "photo-arrival",
  },
];

/** Compatibility shape retained until the legacy Palmares component is replaced. */
export type LogroDestacado = Omit<AchievementGroup, "venue"> & {
  venue: string;
  event: string;
  representation: string;
  categories: string;
};
export const LOGRO_DESTACADO: LogroDestacado = {
  ...ACHIEVEMENT_GROUPS[0],
  venue: "Asunción, Paraguay",
  event: "Sudamericano Sub-11 y Sub-13",
  representation: "Selección de Ecuador",
  categories: "Sub-11 y Sub-13",
};

/** Existing demo photos, reused as provisional visual references only. */
export const MAS_PODIOS: string[] = ACHIEVEMENT_GROUPS.slice(1, 5).map(({ photo }): string => photo);

export const PODIO_DIMENSIONS: Record<string, { width: number; height: number }> = {
  "photo-southamerican": { width: 934, height: 1000 },
  "photo-podium-home": { width: 750, height: 1000 },
  "photo-podium-away": { width: 750, height: 1000 },
  "photo-first-medals": { width: 626, height: 1000 },
  "photo-young-medalists": { width: 750, height: 1000 },
  "photo-community": { width: 1000, height: 750 },
  "photo-arrival": { width: 1000, height: 750 },
};
