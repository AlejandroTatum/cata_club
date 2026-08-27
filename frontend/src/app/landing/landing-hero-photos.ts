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
    src: "/landing/hero-community.jpg",
    alt: "Deportistas, entrenadores y familias de Cata Club reunidos",
    caption: "La comunidad",
    tabDescription: "la comunidad del club",
    objectPosition: "50% 50%",
  },
  {
    src: "/landing/hero-competition.jpg",
    alt: "Dos estudiantes de Cata Club posando",
    caption: "Dos estudiantes del club",
    tabDescription: "estudiantes del club posando",
    objectPosition: "50% 42%",
  },
  {
    src: "/landing/hero-training.jpg",
    alt: "Deportistas de Cata Club entrenando tenis de mesa en el club",
    caption: "En entrenamiento",
    tabDescription: "entrenando en el club",
    objectPosition: "50% 50%",
  },
];
