/**
 * WeekStrip — the week as seven fixed boxes.
 *
 * D9 of `docs/ux/rediseno-visual-2026-08.md`, rule of format: "Los días son
 * siempre siete casillas fijas en el mismo orden […] el formato lo impone el
 * sistema, no el dato." What it replaces is free text — "Mar y jue", "Lun y
 * mié", "Sin horario" — which gave one column four different lengths, so two
 * rows could not be compared without reading both of them word by word. Seven
 * boxes in fixed positions are compared by looking.
 *
 * ## The letters are not abbreviations
 *
 * D9 declares this the single exception to its rule of words, and says why:
 * the letters "no son palabras abreviadas sino posiciones de una escala —se lee
 * el dibujo, no el texto". That is also why two consecutive Ms are legible.
 * Each letter is the first letter of the day's own name rather than a value
 * from a second table, so there is no short-name vocabulary to drift.
 *
 * ## The accessible label is half the piece
 *
 * Information carried by shape needs a text alternative (WCAG 1.1.1), and the
 * alternative has to be the SENTENCE, not the drawing spelled out: somebody who
 * cannot see the strip must receive "Martes y jueves", never "L M M J V S D".
 * So the strip is one `role="img"` with an `aria-label` in whole words, and the
 * boxes inside it are hidden from the accessibility tree.
 *
 * Per-box `title` stays, because it answers a different person's question — the
 * sighted reader meeting the scale for the first time, hovering the third box
 * to learn that it is Miércoles. It is deliberately NOT duplicated as
 * screen-reader text inside each box: ARIA makes the descendants of a
 * `role="img"` presentational, so that markup could never be read out, and
 * accessibility markup that cannot be reached is worse than none — it reads as
 * a solved problem.
 *
 * "Sin horario" is not a state of its own. It is the strip with nothing lit,
 * and its label says so in words.
 */

import type { ReactElement } from "react";
import { DIA_SEMANA_LABELS } from "@/app/attendance/attendance-utils";
import { joinWithY } from "@/lib/format-utils";
import type { DiaSemana } from "@/types/domain";
import { cn } from "./cn";

/**
 * The week, in the order the club reads it.
 *
 * Read off `DIA_SEMANA_LABELS` rather than declared again — the same move
 * `attendance-utils.ts:421` already makes to order a week. The day names come
 * from that table too (it is the product's `DiaSemana` → Spanish map, and
 * `components/attendance/AttendanceFilters.tsx:38` is the precedent for a
 * component reading it); the reverse edge from that module back into `ui/` is
 * `import type` only, so nothing circular exists at runtime.
 */
const WEEK = Object.keys(DIA_SEMANA_LABELS) as DiaSemana[];

/** 20px square at `DataBox`'s 3px corner — the box scale, not the control ladder. */
const BOX =
  "flex h-5 w-5 items-center justify-center rounded-[3px] text-2xs font-bold tracking-flat";

/**
 * A day that runs. White on `cata-red` is 5.00:1, the pair the CTA already
 * stands on, and the red fill is 4.56:1 against the idle fill beside it — well
 * clear of WCAG 1.4.11's 3:1, which matters because "which boxes are lit" is
 * the whole message.
 */
const ACTIVE = "bg-cata-red text-white";

/**
 * A day that does not. `sunken` fill, `ink-3-strong` letter (5.40:1).
 *
 * There is no border, and that is measured rather than minimalist: `line` on
 * `sunken` is 1.219:1 and `line-2` is 1.408:1, so an outline could not be what
 * makes the box perceivable. The fill does that job — 1.098:1 on `paper` and
 * 1.112:1 on `canvas`, the ladder's own rung, on both surfaces a table stands
 * on — and the seven POSITIONS are marked by seven letters, which are text at
 * 5.40:1 rather than a 1.2:1 hairline.
 */
const IDLE = "bg-sunken text-ink-3-strong";

/**
 * A día the caller is ALLOWED to use and does not.
 *
 * Only reachable by passing `permitidos`, and it exists because `/groups` had
 * the fact and no way to say it: a categoría has a track of días — five for
 * most, six for Competitivo — and the row must show both which ones it meets
 * and which ones it could. That screen drew it as a variable-length row of
 * 3-letter pills, which is the column of four different lengths this strip was
 * built to end, so the choice was to fold the third state in here or to delete
 * a fact an admin uses to decide.
 *
 * It is drawn as an OUTLINE on the idle fill rather than a fourth colour: the
 * strip's message is "which boxes are lit", and a third fill would compete with
 * the lit ones for that reading. A dashed border says "available, not taken"
 * without entering the lit/unlit comparison at all — and it is the same dashed
 * treatment the screen already used for the same fact, kept rather than
 * reinvented. `line-2` on `sunken` measures 1.408:1, which is why the letter,
 * not the border, is still what makes the box perceivable.
 */
const AVAILABLE = "bg-sunken text-ink-3-strong border border-dashed border-line-2";

/**
 * THE SAME THREE STATES ON A COAL GROUND.
 *
 * The strip's message is "which boxes are lit", and every value above is
 * measured against the light surfaces a table stands on. Dropped on the
 * carnet's coal credential, `bg-sunken` (#F4F4F7) is the BRIGHTEST thing on
 * the card: the five days that do NOT run end up shouting louder than the two
 * that do, which inverts the piece.
 *
 * So the ground gets its own skin, and it is a VARIANT of this component
 * rather than a `[&_span]` rule reaching in from the carnet. Half of this piece
 * is a contract — the 3:1 that makes lit tellable from unlit, and the label
 * that carries the whole message to a reader who cannot see it — and a caller
 * repainting the fills from outside can take the first one with it silently.
 *
 * Measured on `coal` (#131316), which is the only ground this variant is for:
 *   · idle `white/5` composites to #1F1F22. Against the lit `cata-red` that is
 *     3.13:1, clear of WCAG 1.4.11's 3:1 — the same job the light variant's
 *     4.56:1 does. A heavier fill reads brighter and falls under it: `white/10`
 *     measures 2.76:1 and was rejected for exactly that.
 *   · `text-white/70` on that fill is ~8.5:1, so the seven POSITIONS are still
 *     marked by seven letters that are comfortably legible text.
 *   · the dashed outline moves to `white/25`; `line-2` is a light-surface
 *     hairline and is simply invisible here.
 */
const ON_COAL = {
  activo: ACTIVE,
  inactivo: "bg-white/5 text-white/70",
  disponible: "bg-white/5 text-white/70 border border-dashed border-white/25",
} as const;

/** Nothing lit. In words, because the strip's label is what a reader receives. */
const NO_SCHEDULE = "Sin horario";

/**
 * The sentence the strip says: "Martes y jueves", "Lunes, miércoles y viernes".
 *
 * Always in week order, never in the order the caller passed, so two rows that
 * hold the same days announce the same sentence. Only the first day keeps its
 * capital — the rest are inside a sentence, not headings.
 */
function scheduleLabel(days: readonly DiaSemana[]): string {
  const named = WEEK.filter((day) => days.includes(day)).map((day, index) =>
    index === 0
      ? DIA_SEMANA_LABELS[day]
      : DIA_SEMANA_LABELS[day].toLocaleLowerCase("es"),
  );
  return joinWithY(named) || NO_SCHEDULE;
}

export interface WeekStripProps {
  /**
   * The days that run, in any order, duplicates allowed. `DiaSemana` is the
   * frontend's own weekday shape (`types/domain.ts:176`); the backend's
   * `"LUNES"`…`"DOMINGO"` are translated at the BFF boundary by
   * `DIA_SEMANA_BACKEND_TO_FRONTEND` (`lib/server/attendance-adapter.ts:56`),
   * so a screen holding backend values already has the map it needs and the
   * strip does not grow a second one.
   */
  dias: readonly DiaSemana[];
  /**
   * The días the caller is ALLOWED to run, when that is a different set from
   * the ones it does. Omit it and the strip is exactly two-state.
   *
   * It never changes the spoken label: the sentence answers "when does this
   * meet", and a track is an option, not a session.
   */
  permitidos?: readonly DiaSemana[];
  /**
   * The ground the strip is drawn on. `light` (the default) is every table and
   * card in the product; `onCoal` is the carnet's credential, and nothing else
   * today. See `ON_COAL` for the measurements.
   */
  variant?: WeekStripVariant;
  className?: string;
}

/** Which measured skin the boxes wear. See `IDLE` and `ON_COAL`. */
export type WeekStripVariant = "light" | "onCoal";

/** `activo` beats `disponible` beats `inactivo` — a día that runs is never merely available. */
function dayState(
  day: DiaSemana,
  dias: readonly DiaSemana[],
  permitidos?: readonly DiaSemana[],
): "activo" | "disponible" | "inactivo" {
  if (dias.includes(day)) return "activo";
  if (permitidos?.includes(day)) return "disponible";
  return "inactivo";
}

const TONE = {
  light: { activo: ACTIVE, disponible: AVAILABLE, inactivo: IDLE },
  onCoal: ON_COAL,
} as const;

export default function WeekStrip({
  dias,
  permitidos,
  variant = "light",
  className,
}: WeekStripProps): ReactElement {
  return (
    <span
      role="img"
      data-testid="week-strip"
      aria-label={scheduleLabel(dias)}
      className={cn("inline-flex items-center gap-0.5", className)}
    >
      {WEEK.map((day) => {
        const state = dayState(day, dias, permitidos);
        return (
          <span
            key={day}
            data-day={day}
            data-state={state}
            title={DIA_SEMANA_LABELS[day]}
            aria-hidden="true"
            className={cn(BOX, TONE[variant][state])}
          >
            {DIA_SEMANA_LABELS[day].charAt(0)}
          </span>
        );
      })}
    </span>
  );
}
