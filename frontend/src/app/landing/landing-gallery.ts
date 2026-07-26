export interface GalleryPhoto {
  src: string;
  /**
   * The file's real pixel size. Every asset is exported at one uniform height,
   * so this is what gives each slide its width — and it is what lets `sizes`
   * name a real width per photo instead of one guess for all of them.
   */
  width: number;
  height: number;
  /** Describes the photograph for assistive technology. */
  alt: string;
  /** The line printed over the photo. Tells the story; never the description. */
  caption: string;
}

/**
 * Rendered slide height, mirroring `--landing-slide-height` in landing.css.
 * `sizes` is resolved by the browser before any stylesheet applies, so these
 * cannot be read from CSS and must be kept in step with it by hand — the test
 * suite checks that they still match.
 */
export const SLIDE_HEIGHT_DESKTOP = 468;
export const SLIDE_HEIGHT_MOBILE = 340;
/** The viewport at which landing.css swaps the two heights above. */
export const SLIDE_HEIGHT_BREAKPOINT = 768;

/**
 * Photos keep their own aspect ratio: the strip is uniform in height and free
 * in width. Cropping every frame to one portrait box would take 55% of the
 * width off the wide group shots — in a club gallery those people ARE the
 * content. It also makes width the binding dimension under `object-fit: cover`,
 * which is the only dimension `sizes` can describe, so the browser stops being
 * asked to blow a landscape photo up to fill a portrait frame.
 */
export function slideSizes(photo: GalleryPhoto): string {
  const aspect = photo.width / photo.height;
  return `(max-width: ${SLIDE_HEIGHT_BREAKPOINT}px) ${Math.round(SLIDE_HEIGHT_MOBILE * aspect)}px, ${Math.round(SLIDE_HEIGHT_DESKTOP * aspect)}px`;
}

/**
 * The carousel set, ordered so the strongest frames land first: the only real
 * action shot, then the club's highest competitive credential. The loop is
 * seamless, so this order is what a visitor sees before they touch anything.
 */
export const GALLERY_PHOTOS: GalleryPhoto[] = [
  {
    src: "/landing/photo-serve.jpeg",
    width: 1500,
    height: 1000,
    alt: "Deportista infantil de Cata Club ejecutando un saque durante un torneo",
    caption: "Cada punto se juega",
  },
  {
    src: "/landing/photo-southamerican.jpeg",
    width: 934,
    height: 1000,
    alt: "Deportistas de Cata Club con el uniforme de Ecuador en el Campeonato Sudamericano Sub-11 y Sub-13",
    caption: "Sudamericano Sub-11 y Sub-13 · Asunción",
  },
  {
    src: "/landing/photo-podium-home.jpeg",
    width: 750,
    height: 1000,
    alt: "Deportistas de Cata Club celebrando en el podio con los brazos en alto",
    caption: "Podio en casa",
  },
  {
    src: "/landing/photo-delegation.jpeg",
    width: 1527,
    height: 1000,
    alt: "Delegación completa de Cata Club posando junto a la bandera de Ecuador",
    caption: "Delegación Cata Club",
  },
  {
    src: "/landing/photo-champions-banner.jpeg",
    width: 1778,
    height: 1000,
    alt: "Deportistas premiados frente al banner institucional de Cata Club",
    caption: "Formando campeones para la vida",
  },
  {
    src: "/landing/photo-coach-athlete.jpeg",
    width: 667,
    height: 1000,
    alt: "Entrenador de Cata Club acompañando a una deportista tras su competencia",
    caption: "Entrenar es acompañar",
  },
  {
    src: "/landing/photo-team-stands.jpeg",
    width: 1333,
    height: 1000,
    alt: "Equipo completo de Cata Club reunido en las graderías del gimnasio",
    caption: "El equipo completo",
  },
  {
    src: "/landing/photo-first-medals.jpeg",
    width: 626,
    height: 1000,
    alt: "Deportistas jóvenes de Cata Club mostrando sus medallas junto a su entrenadora",
    caption: "Las primeras medallas",
  },
  {
    src: "/landing/photo-podium-away.jpeg",
    width: 750,
    height: 1000,
    alt: "Deportistas de Cata Club en el podio de un torneo fuera de Loja",
    caption: "Fuera de casa también",
  },
  {
    src: "/landing/photo-community.jpeg",
    width: 1000,
    height: 1000,
    alt: "Grupo numeroso de deportistas, entrenadores y familias de Cata Club celebrando",
    caption: "Una comunidad de todas las edades",
  },
  {
    src: "/landing/photo-tournament-hall.jpeg",
    width: 1333,
    height: 1000,
    alt: "Vista general del gimnasio con varias mesas en juego durante un torneo",
    caption: "Días de torneo",
  },
  {
    src: "/landing/photo-squad.jpeg",
    width: 1404,
    height: 1000,
    alt: "Equipo de Cata Club con uniforme de viaje antes de una competencia",
    caption: "Listos para competir",
  },
  {
    src: "/landing/photo-young-medalists.jpeg",
    width: 750,
    height: 1000,
    alt: "Tres deportistas infantiles de Cata Club celebrando con sus medallas",
    caption: "Nuestras futuras promesas",
  },
  {
    src: "/landing/photo-facility.jpeg",
    width: 1333,
    height: 1000,
    alt: "Instalaciones de Cata Club con las mesas de juego preparadas para el entrenamiento",
    caption: "Nuestra casa, todos los días",
  },
];
