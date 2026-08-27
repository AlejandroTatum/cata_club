export interface GalleryPhoto {
  src: string;
  /** The file's real pixel size, used to calculate a precise responsive image width. */
  width: number;
  height: number;
  /** Describes the photograph for assistive technology. */
  alt: string;
  /** The line printed over the photo. */
  caption: string;
}

/** Rendered slide height, mirroring `--landing-slide-height` in landing.css. */
export const SLIDE_HEIGHT_DESKTOP = 468;
export const SLIDE_HEIGHT_MOBILE = 340;
/** The viewport at which landing.css swaps the two heights above. */
export const SLIDE_HEIGHT_BREAKPOINT = 768;

/** Keep each photograph's aspect ratio so the carousel does not crop its subject. */
export function slideSizes(photo: GalleryPhoto): string {
  const aspect = photo.width / photo.height;
  return `(max-width: ${SLIDE_HEIGHT_BREAKPOINT}px) ${Math.round(SLIDE_HEIGHT_MOBILE * aspect)}px, ${Math.round(SLIDE_HEIGHT_DESKTOP * aspect)}px`;
}

export const GALLERY_PHOTOS: GalleryPhoto[] = [
  {
    src: "/landing/gallery-02-action.jpg",
    width: 1600,
    height: 1066,
    alt: "Niña de Cata Club jugando tenis de mesa frente a una mesa con público al fondo",
    caption: "En juego",
  },
  {
    src: "/landing/gallery-04-training.jpg",
    width: 1600,
    height: 1200,
    alt: "Deportistas de Cata Club reunidos junto a varias mesas de tenis de mesa",
    caption: "La sala se llena",
  },
  {
    src: "/landing/gallery-08-coaching.jpg",
    width: 1600,
    height: 1200,
    alt: "Deportistas de Cata Club practicando tenis de mesa con un entrenador",
    caption: "Tiempo de aprender",
  },
  {
    src: "/landing/gallery-12-team.jpg",
    width: 1200,
    height: 1600,
    alt: "Tres deportistas de Cata Club jugando tenis de mesa en una sala de entrenamiento",
    caption: "Cada mesa cuenta",
  },
  {
    src: "/landing/gallery-03-play.jpg",
    width: 1600,
    height: 1200,
    alt: "Deportistas de Cata Club reunidos junto a varias mesas de tenis de mesa",
    caption: "El equipo, reunido",
  },
  {
    src: "/landing/gallery-01-group.jpg",
    width: 1068,
    height: 1600,
    alt: "Deportistas y entrenadores de Cata Club posando juntos en la sala de entrenamiento",
    caption: "El club, reunido",
  },
  {
    src: "/landing/gallery-17-team.jpg",
    width: 1600,
    height: 1200,
    alt: "Grupo de deportistas de Cata Club y entrenadores reunido frente a varias mesas",
    caption: "Juntos en la sala",
  },
  {
    src: "/landing/gallery-19-group.jpg",
    width: 1200,
    height: 1600,
    alt: "Deportistas y entrenadores de Cata Club posando juntos con sus uniformes",
    caption: "Un equipo unido",
  },
];
