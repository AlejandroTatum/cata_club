/**
 * The landing gallery's data contract and presentation plan (issue #1372).
 *
 * The gallery used to be a hand-written list of bundled photographs. It is
 * now managed by the club: an admin publishes each entry with its photo,
 * title and description (see `/galeria`), and this section renders only what
 * `GET /api/galeria` returns. The gallery starts empty, and the landing says
 * so honestly instead of shipping photos nobody uploaded.
 *
 * The presentation is the pre-#1372 full-bleed moving strip again: uniform
 * slide height, native aspect ratios, one endless GSAP pass owned by
 * `LandingMotion`. Because entries now arrive asynchronously, the strip
 * cannot be measured at the motion runtime's mount the way the bundled
 * gallery used to be — `Gallery` measures its photos, plans the slide run
 * here, marks its track `[data-ready]` and announces `landing:gallery-ready`;
 * the runtime enhances only a ready track, in either mount order.
 *
 * Same shape and same reasoning as `mapSponsor` in `Sponsors.tsx`: the wire
 * contract is the backend's public payload — camelCase via the ResponseBase
 * alias generator (`imagen_url` -> `imagenUrl`, asserted by
 * backend/tests/test_galeria.py) — and malformed rows are dropped rather
 * than rendered as broken cards.
 */

export interface GalleryEntry {
  /** Numeric id from the backend — the stable identity used for React keys. */
  id: number;
  /** The entry's headline, printed over the card. */
  title: string;
  /** Describes the photograph for every visitor — readable, not hover-only. */
  description: string;
  /** Public URL of the hosted photo (Cloudinary). */
  imageSrc: string;
}

/**
 * One record of the public backend payload at GET /api/galeria. Every field
 * is `unknown`-typed on purpose: the payload crosses a network boundary, and
 * mapping validates instead of trusting.
 */
export interface PublicGalleryPayload {
  id?: unknown;
  titulo?: unknown;
  descripcion?: unknown;
  imagenUrl?: unknown;
}

/**
 * Maps one public backend record into the landing's gallery shape, dropping
 * records that carry no usable id, title, description or photo URL so a
 * malformed row can never render a blank card or a broken image.
 */
export function mapGalleryEntry(payload: PublicGalleryPayload): GalleryEntry | null {
  if (
    typeof payload?.id !== "number"
    || typeof payload?.titulo !== "string"
    || typeof payload?.descripcion !== "string"
    || typeof payload?.imagenUrl !== "string"
  ) return null;
  const title = payload.titulo.trim();
  const description = payload.descripcion.trim();
  const imageSrc = payload.imagenUrl.trim();
  if (!title || !description || !imageSrc) return null;
  return { id: payload.id, title, description, imageSrc };
}

/** Maps the whole published list, keeping backend order and dropping malformed rows. */
export function mapGallery(payload: unknown): GalleryEntry[] {
  if (!Array.isArray(payload)) return [];
  return payload
    .map((entry): GalleryEntry | null => mapGalleryEntry(entry as PublicGalleryPayload))
    .filter((entry): entry is GalleryEntry => entry !== null);
}

/** Rendered slide height on desktop — the pre-#1372 value, in landing.css too. */
export const SLIDE_HEIGHT_DESKTOP = 468;
/** Rendered slide height on mobile — the pre-#1372 value, in landing.css too. */
export const SLIDE_HEIGHT_MOBILE = 340;
/** The viewport at which landing.css swaps the two heights above. */
export const SLIDE_HEIGHT_BREAKPOINT = 768;
/** The strip's flex gap, mirrored from `.landing-carousel` in landing.css. */
export const SLIDE_GAP_PX = 22;
/**
 * Stands in for a photograph whose ratio could not be measured (broken file,
 * hung request). Landscape, like most club photos; a mismatched ratio only
 * ever letterboxes inside the slide's own frame, never another's.
 */
export const DEFAULT_SLIDE_ASPECT = 3 / 2;

/** Fired on `document` once the track holds its full planned run. */
export const GALLERY_READY_EVENT = "landing:gallery-ready";
/** Fired on `document` when a card becomes (or stops being) worth reading. */
export const GALLERY_HOLD_EVENT = "landing:gallery-hold";
/** Fired on `document` when a visitor asks the strip to bring one photo forward. */
export const GALLERY_SEEK_EVENT = "landing:gallery-seek";

/** Which way a browse request travels around the loop. */
export type GallerySeekDirection = "next" | "prev";

/** Payload of `GALLERY_SEEK_EVENT`: the requested UNIQUE photo, by catalog index. */
export interface GallerySeekDetail {
  index: number;
  direction: GallerySeekDirection;
}

/** How long a browse (arrow button or arrow key) keeps the strip still for reading before the loop resumes on its own. Hover or keyboard focus inside the strip extends the hold past this window. */
export const GALLERY_BROWSE_HOLD_MS = 5000;

/** Offsets below this many pixels count as "already aligned" — layout math is float, intent is integer. */
const ALIGNED_EPSILON_PX = 0.5;

/**
 * Signed pixels of pattern travel that align the requested photo with the
 * strip's left edge.
 *
 * The loop is a rigid pattern translating forward (leftward) forever: at
 * travel `t` the photo sits aligned when `t ≡ targetOffset (mod loopWidth)`.
 * `next` takes the short way FORWARD — the direction the autoplay already
 * reads, so a browse never makes the strip lurch against its own current —
 * and `prev` takes the equally short way BACKWARD through the seam, which is
 * what makes the loop feel endless in both directions. A request for a photo
 * that is already aligned travels nothing; the caller still pins its caption.
 */
export function seekDeltaPx(
  currentOffsetPx: number,
  targetOffsetPx: number,
  loopWidthPx: number,
  direction: GallerySeekDirection,
): number {
  const raw = targetOffsetPx - currentOffsetPx;
  const forward = ((raw % loopWidthPx) + loopWidthPx) % loopWidthPx;
  const shortest = Math.min(forward, loopWidthPx - forward);
  if (shortest < ALIGNED_EPSILON_PX) return 0;
  return direction === "next" ? forward : forward - loopWidthPx;
}

/** One slide of the planned run: a published entry, or a visual repeat of one. */
export interface PlannedSlide {
  entry: GalleryEntry;
  /** Visual clones exist only so the loop can fill the viewport; they are aria-hidden. */
  clone: boolean;
}

/** Slide width at the section's fixed height, from the photo's native ratio. */
export function slideWidthPx(aspect: number, mobile: boolean): number {
  return Math.round((mobile ? SLIDE_HEIGHT_MOBILE : SLIDE_HEIGHT_DESKTOP) * aspect);
}

/** How much track one pass over `count` slides travels — the loop's own math. */
function runWidthPx(widths: number[], count: number): number {
  const total = widths.reduce((sum, width): number => sum + width, 0) * count;
  return total + SLIDE_GAP_PX * count;
}

const MAX_RUNS = 24;

/**
 * Repeats the published entries, in order, until one pass over the run is
 * wide enough to keep the viewport covered for the whole loop. A catalog of
 * one or two photos — the demo preview's real state — would otherwise drift
 * across a mostly empty track; the repeats are presentation-only and their
 * callers mark them aria-hidden, so assistive technology still reads each
 * photo exactly once.
 */
export function planSlideRun(
  entries: GalleryEntry[],
  aspectFor: (entry: GalleryEntry) => number,
  viewportWidth: number,
  mobile: boolean,
): PlannedSlide[] {
  if (entries.length === 0) return [];
  const widths = entries.map((entry): number => slideWidthPx(aspectFor(entry), mobile));
  // One extra gap of margin: at the wrap instant the pattern must not present
  // the seam right at the viewport's far edge.
  const target = viewportWidth + SLIDE_GAP_PX;
  let runs = 1;
  while (runs < MAX_RUNS && runWidthPx(widths, runs) < target) runs += 1;
  const run: PlannedSlide[] = [];
  for (let index = 0; index < runs * entries.length; index += 1) {
    run.push({ entry: entries[index % entries.length], clone: index >= entries.length });
  }
  return run;
}
