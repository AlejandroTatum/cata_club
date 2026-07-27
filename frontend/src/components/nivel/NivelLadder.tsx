/**
 * NivelLadder — "la escalera", the club's training ladder rendered as what it
 * actually is: an ordinal scale where the first rung is the top.
 *
 * TWO NUMBERS, ONE RUNG — the defect this component was rebuilt to fix. The
 * club's ELEVEN levels are NAMED "1A", "1B", "2", "3" … "10" against
 * `numero_nivel` 1…11, so from the third rung down the name and the rank are
 * different numbers. The previous ladder put both on the same row — a chip
 * reading "3" next to a name reading "2" — which is the most confusing thing a
 * screen can do with two integers.
 *
 * The rule now: THE NAME LEADS, THE RANK IS SUBORDINATE. The name is what
 * people say out loud ("está en el 2"), so it is the only LEVEL number
 * rendered. The rank is carried by the things that do not need a digit —
 * reading order (the list is an `<ol>`, sorted ascending, so reading order IS
 * rank order), the rail that threads the rungs together, and the node's
 * darkness, which fades from solid at the top to faint at the base. It stays
 * announceable through the node's "Puesto N de la escalera" title for anyone
 * who needs the exact rank.
 *
 * ## v4 — the headcount, and the roster moving into the panel
 *
 * Two things the product owner asked for after using v3:
 *
 *   1. *"en nivel que también me salgan cuántos alumnos exactamente tienen ese
 *      nivel"*. Each rung now states its headcount outright. It is a PLAIN
 *      COUNT — how many students hold this level — never a capacity reading:
 *      no denominator, no bar, no warning. See the product rules below.
 *   2. *"no me convence la idea de mostrarlo directo en la barra horizontal"*.
 *      The rung no longer carries the whole roster inline. Expanding it opens
 *      the two-column panel the caller supplies (unassigned LEFT, assigned
 *      RIGHT), which is where the names now live.
 *
 * The one exception to (2) is the page-level person search: when a rung holds
 * a student the search matched, THOSE names — and only those — are picked out
 * on the rung itself. "Where is Juan?" is answered by looking at the ladder,
 * which is the entire reason the search exists; showing one matched name is not
 * the same thing as printing a nine-name roster on every rung.
 *
 * Layout transcribed from `docs/ux/prototipos/13-niveles.html` and the
 * `_sistema.css` rules it uses: `.rung` (:277) 20px side padding and a
 * `--line` bottom rule suppressed on the last rung; `.rung::before` (:279-281)
 * the 2px rail at left:34px, cut back 30px at the first and last rung so it
 * starts and ends at a node rather than running off the card.
 *
 * Product rules this component exists to enforce (settled, not preferences):
 *   - The first rung is the top of the ladder. Reading order is rank order.
 *   - NO occupancy: no meters, no "N/M" fractions, no minimum-headcount
 *     warning. `cuposDisponibles`/`necesitaRevision` exist in the API payload
 *     and deliberately never reach this component's props — and neither does
 *     `personasActuales`. The headcount a rung shows is `students.length`, i.e.
 *     derived from the roster the panel lists BY NAME, so the number and the
 *     names can never disagree.
 *   - ONE control per rung, and it names BOTH things it does: "Ver y asignar".
 *     It used to read "Asignar estudiantes", which hid the fact that the panel
 *     it opens is also the only place the level's roster is listed by name —
 *     so seeing who holds a level meant pressing a button that reads like it
 *     changes something. There is still no "Promover".
 */

"use client";

import { type ReactElement, type ReactNode } from "react";
import { Button, cn } from "@/components/ui";

export interface LadderStudent {
  id: string;
  /** Full display name. */
  nombre: string;
}

/**
 * One rung. Note what is NOT here: capacity, occupancy, headcount minimums.
 * The ladder says how many students hold the level and who they are; it never
 * says how full it is.
 */
export interface LadderRung {
  /** `nivel_ranking.id` — the value the assign endpoints take. */
  id: number;
  /** The rank. The lowest is the top of the ladder. */
  numeroNivel: number;
  /** The club's own name for the rung — "1A", "2", "10". */
  nombre: string;
  students: LadderStudent[];
}

export interface NivelLadderProps {
  rungs: LadderRung[];
  /** Toggles the rung's two-column panel — its roster and its assign column. */
  onAssign: (nivelId: number) => void;
  /** `nivel.id` whose panel is currently open, if any. */
  openNivelId?: number | null;
  /** The two-column panel, rendered under the open rung. */
  renderPanel?: (nivelId: number) => ReactNode;
  /**
   * Students the page-level search matched. Their names are picked out on the
   * rung they sit on, so "where is Juan?" is answered by looking at the ladder
   * rather than by trusting a separate result list.
   */
  highlightIds?: ReadonlySet<string>;
  className?: string;
}

/** How a rung states its headcount. A plain count, never a fraction. */
export function headcountLabel(count: number): string {
  if (count === 0) return "Sin estudiantes";
  if (count === 1) return "1 estudiante";
  return `${count} estudiantes`;
}

/**
 * The rung's node on the rail.
 *
 * Carries the rank WITHOUT a digit: `depth` (0 at the top, 1 at the base) fades
 * the node from solid ink to faint, so the ladder still reads as a descent. An
 * opacity computed from position needs no per-rung colour token and cannot
 * drift out of step with a ladder that gains or loses a rung.
 */
function RungNode({
  numeroNivel,
  depth,
  open,
}: {
  numeroNivel: number;
  depth: number;
  open: boolean;
}): ReactElement {
  const title = `Puesto ${numeroNivel} de la escalera`;
  return (
    <span
      title={title}
      className={cn(
        "relative z-[1] flex h-7 w-7 flex-none items-center justify-center rounded-lg ring-4 ring-paper",
        open ? "bg-coal" : "bg-ink",
      )}
      style={open ? undefined : { opacity: 1 - depth * 0.62 }}
    >
      <span className="sr-only">{title}</span>
      <span
        aria-hidden="true"
        className={cn("h-2 w-2 rounded-full", open ? "bg-ball" : "bg-paper")}
      />
    </span>
  );
}

export default function NivelLadder({
  rungs,
  onAssign,
  openNivelId = null,
  renderPanel,
  highlightIds,
  className,
}: NivelLadderProps): ReactElement {
  const highlighted = highlightIds ?? new Set<string>();

  // Sorted here rather than trusted from the caller: reading order IS rank
  // order on this screen, so it is not something a call site gets to get wrong.
  const ordered = [...rungs].sort((a, b) => a.numeroNivel - b.numeroNivel);
  const lastIndex = ordered.length - 1;

  return (
    <ol className={cn("flex flex-col", className)}>
      {ordered.map((rung, index) => {
        const isFirst = index === 0;
        const isLast = index === lastIndex;
        const isOpen = openNivelId === rung.id;
        const count = rung.students.length;
        const matches = rung.students.filter((student) => highlighted.has(student.id));

        return (
          <li key={rung.id} className={cn("border-b border-line", isLast && "border-b-0")}>
            <div
              className={cn(
                "relative flex min-h-row flex-wrap items-center gap-x-3.5 gap-y-2 px-5 py-2.5",
                // The rail. `content-['']` is what makes the pseudo-element real.
                "before:absolute before:left-[34px] before:w-0.5 before:bg-line before:content-['']",
                isFirst ? "before:top-[30px]" : "before:top-0",
                isLast ? "before:bottom-[30px]" : "before:bottom-0",
              )}
            >
              <RungNode
                numeroNivel={rung.numeroNivel}
                depth={lastIndex === 0 ? 0 : index / lastIndex}
                open={isOpen}
              />

              {/* The club's own name for the rung, and the only LEVEL number on it. */}
              <span
                title={rung.nombre}
                className="w-20 flex-none truncate text-sm font-bold text-ink"
              >
                {rung.nombre}
              </span>

              {/* How many students hold this level. The figure is a fact about
                  the rung, so it is set in ink like every other stat figure;
                  the empty rung has no figure to set and stays muted. */}
              <span
                data-testid={`rung-headcount-${rung.id}`}
                className={cn(
                  "flex-none text-[13px] tabular-nums",
                  count === 0 ? "text-ink-3" : "font-semibold text-ink",
                )}
              >
                {headcountLabel(count)}
              </span>

              {/* Only the names the page search asked about. The full roster
                  lives in the panel, two columns wide, where it can be acted on. */}
              <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
                {matches.map((student) => (
                  <span
                    key={student.id}
                    title={student.nombre}
                    className="rounded-[6px] bg-ball px-1.5 py-0.5 text-[12.5px] font-bold text-ball-ink"
                  >
                    {student.nombre}
                  </span>
                ))}
              </span>

              <Button
                size="sm"
                // `ml-auto` only bites when the row wraps on a narrow screen:
                // the action stays at the right edge instead of dropping onto
                // the rail it would otherwise sit on top of.
                className="ml-auto flex-none"
                onClick={() => onAssign(rung.id)}
                aria-expanded={isOpen}
                /* Same words as the visible label, plus the rung it belongs to
                   — the accessible name must contain the visible one. */
                aria-label={`Ver y asignar estudiantes del nivel ${rung.nombre}`}
              >
                Ver y asignar
              </Button>
            </div>

            {isOpen && renderPanel ? renderPanel(rung.id) : null}
          </li>
        );
      })}
    </ol>
  );
}
