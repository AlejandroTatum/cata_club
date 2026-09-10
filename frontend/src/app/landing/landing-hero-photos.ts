export interface HeroPhoto {
  src: string;
  alt: string;
  /** Focal point inside the 6:5 cover frame, so vertical crops keep faces visible. */
  objectPosition: string;
}

/**
 * The hero's photo carousel set, browsed with previous/next arrows.
 * Deliberately just three photos, all reused from the existing
 * `public/landing/` set — never `hero-action.jpeg`, the old single hero
 * photo this carousel replaces.
 */
export const HERO_PHOTOS: HeroPhoto[] = [
  {
    src: "/landing/hero-community.jpg",
    alt: "Deportistas, entrenadores y familias de Cata Club reunidos",
    objectPosition: "50% 50%",
  },
  {
    src: "/landing/hero-competition.jpg",
    alt: "Dos estudiantes de Cata Club posando",
    objectPosition: "50% 42%",
  },
  {
    src: "/landing/hero-training.jpg",
    alt: "Deportistas de Cata Club entrenando tenis de mesa en el club",
    /*
     * The desktop seam cuts `.landing-hero-carousel`'s own box on a diagonal:
     * the box starts at 44% of the viewport and the seam's bottom-left corner
     * sits at 14% further in, so the leftmost sliver of the box — where a
     * player standing at the crop's own left edge used to land — is exactly
     * what the seam removes. At the source framing, that sliver held a
     * player and the top half of the crop was roof. Shifting the focal point
     * right and down moves both the tables and the players into the part of
     * the frame the seam never touches, at 1280/1440/1920 alike, since the
     * seam's cut is a fixed fraction of the box rather than of the photo.
     */
    objectPosition: "72% 62%",
  },
];
