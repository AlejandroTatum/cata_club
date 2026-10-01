/**
 * One colour per training group, the same on every screen that draws a day.
 *
 * Status already owns the state hues (ok / warn / bad), so a group's identity
 * is carried by the `cuenta` category hues, the ball and the coal instead —
 * colour as CATEGORY, never as health. Known groups keep their colour for
 * good; a group the map has not met takes one from the palette by a stable
 * hash of its name, so it does not change between renders or between screens.
 *
 * Every entry is a set of static class names (Tailwind cannot see a class it
 * has to assemble), and every pair clears AA: `solid` is white or ink on the
 * fill, `text` is the hue read on paper.
 */

export interface GroupTone {
  /** Filled block: fill, border and the text that sits on it. */
  solid: string;
  /** Outline block: border colour. */
  border: string;
  /** Tint under an outline block. */
  tint: string;
  /** The hue as text on paper. */
  text: string;
  /** Dot / stripe. */
  dot: string;
}

const BLUE: GroupTone = {
  solid: "border-cuenta-representante bg-cuenta-representante text-white",
  border: "border-cuenta-representante",
  tint: "bg-cuenta-representante-bg",
  text: "text-cuenta-representante",
  dot: "bg-cuenta-representante",
};
const PURPLE: GroupTone = {
  solid: "border-cuenta-menor bg-cuenta-menor text-white",
  border: "border-cuenta-menor",
  tint: "bg-cuenta-menor-bg",
  text: "text-cuenta-menor",
  dot: "bg-cuenta-menor",
};
const GREEN: GroupTone = {
  solid: "border-cuenta-entrenador bg-cuenta-entrenador text-white",
  border: "border-cuenta-entrenador",
  tint: "bg-cuenta-entrenador-bg",
  text: "text-cuenta-entrenador",
  dot: "bg-cuenta-entrenador",
};
const BALL: GroupTone = {
  solid: "border-ball bg-ball text-ink",
  border: "border-ball",
  tint: "bg-sunken",
  text: "text-ball-ink",
  dot: "bg-ball",
};
const COAL: GroupTone = {
  solid: "border-coal bg-coal text-white",
  border: "border-coal",
  tint: "bg-sunken",
  text: "text-ink",
  dot: "bg-coal",
};

const PALETTE: readonly GroupTone[] = [BLUE, PURPLE, GREEN, BALL, COAL];

/** The club's groups, pinned so their colour is a fact of the product, not of the hash. */
const KNOWN: Record<string, GroupTone> = {
  formativo: BLUE,
  infantil: PURPLE,
  juvenil: GREEN,
  competitivo: BALL,
  adultos: COAL,
};

const normalise = (name: string): string =>
  name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();

export function groupTone(name: string): GroupTone {
  const key = normalise(name);
  if (KNOWN[key]) return KNOWN[key];
  let hash = 0;
  for (const char of key) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return PALETTE[hash % PALETTE.length];
}
