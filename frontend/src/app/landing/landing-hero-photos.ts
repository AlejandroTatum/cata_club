export interface HeroPhoto {
  src: string;
  alt: string;
  /** Caption-bar line shown while this photo is active. */
  caption: string;
  /** Appended to each tab's `aria-label`, so screen readers hear content, not just an ordinal. */
  tabDescription: string;
  /** Focal point inside the 6:5 cover frame, so vertical crops keep faces visible. */
  objectPosition: string;
}

/**
 * The hero's 01/02/03 tab-carousel set. Deliberately just three photos, all
 * reused from the existing `public/landing/` set with hero-specific captions
 * — never `hero-action.jpeg`, the old single hero photo this carousel
 * replaces.
 */
export const HERO_PHOTOS: HeroPhoto[] = [
  {
    src: "/landing/photo-coach-athlete.jpeg",
    alt: "Entrenador y alumna de Cata Club en un torneo",
    caption: "En la mesa",
    tabDescription: "entrenador y alumna",
    objectPosition: "50% 22%",
  },
  {
    src: "/landing/photo-podium-home.jpeg",
    alt: "Seis deportistas de Cata Club festejando con medallas en el podio de un torneo",
    caption: "Celebrando el podio",
    tabDescription: "celebrando en el podio",
    objectPosition: "50% 18%",
  },
  {
    src: "/landing/photo-community.jpeg",
    alt: "Grupo numeroso de deportistas, entrenadores y familias de Cata Club celebrando",
    caption: "La comunidad",
    tabDescription: "la comunidad",
    objectPosition: "50% 50%",
  },
];
