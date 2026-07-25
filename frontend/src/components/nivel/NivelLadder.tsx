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
 * people say out loud ("está en el 2"), so it is the only number rendered. The
 * rank is carried by the things that do not need a digit — reading order (the
 * list is an `<ol>`, sorted ascending, so reading order IS rank order), the
 * rail that threads the rungs together, and the node's darkness, which fades
 * from solid at the top to faint at the base. It stays announceable through the
 * node's "Puesto N de la escalera" title for anyone who needs the exact rank.
 *
 * The roster shows NAMES. It used to be a stack of grey two-letter initials
 * ("AC LA EB +3"), from which you could not tell who was on a rung — the one
 * thing a level roster exists to answer.
 *
 * Layout transcribed from `docs/ux/prototipos/13-niveles.html` and the
 * `_sistema.css` rules it uses: `.rung` (:277) 20px side padding and a
 * `--line` bottom rule suppressed on the last rung; `.rung::before` (:279-281)
 * the 2px rail at left:34px, cut back 30px at the first and last rung so it
 * starts and ends at a node rather than running off the card. The fixed 60px
 * row height is now a minimum: a rung carries real names, which wrap.
 *
 * Product rules this component exists to enforce (settled, not preferences):
 *   - The first rung is the top of the ladder. Reading order is rank order.
 *   - NO occupancy anywhere: no meters, no "N/M" fractions, no minimum-headcount
 *     warning. `cuposDisponibles`/`necesitaRevision` exist in the API payload
 *     and deliberately never reach this component's props.
 *   - ONE action per rung, and it says what it assigns: "Asignar estudiantes".
 *     There is no "Promover".
 */

"use client";

import { useState, type ReactElement, type ReactNode } from "react";
import { Button, cn } from "@/components/ui";

/** How many names a rung shows before collapsing the rest behind "+N más". */
const MAX_NAMES = 3;

export interface LadderStudent {
  id: string;
  /** Full display name. */
  nombre: string;
}

/**
 * One rung. Note what is NOT here: capacity, occupancy, headcount minimums.
 * The ladder shows who is on a rung, never how full it is.
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
  /** Opens the assignment panel for that rung. The rung's only action. */
  onAssign: (nivelId: number) => void;
  /** `nivel.id` whose panel is currently open, if any. */
  openNivelId?: number | null;
  /** Inline panel rendered under the open rung. */
  renderPanel?: (nivelId: number) => ReactNode;
  /**
   * Students the page-level search matched. Their names are picked out on the
   * rung and their rung's roster opens in full, so "where is Juan?" is answered
   * by looking at the ladder rather than by trusting a separate result list.
   */
  highlightIds?: ReadonlySet<string>;
  className?: string;
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

/** The rung's roster, as names. Collapses past `MAX_NAMES` unless asked. */
function RosterNames({
  students,
  expanded,
  onExpand,
  highlightIds,
}: {
  students: LadderStudent[];
  expanded: boolean;
  onExpand: () => void;
  highlightIds: ReadonlySet<string>;
}): ReactElement {
  if (students.length === 0) {
    return <span className="text-[12.5px] text-ink-3">Sin estudiantes</span>;
  }

  const shown = expanded ? students : students.slice(0, MAX_NAMES);
  const rest = students.length - shown.length;

  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
      {shown.map((student) => (
        <span
          key={student.id}
          title={student.nombre}
          className={cn(
            "rounded-[6px] px-1.5 py-0.5 text-[12.5px] text-ink-2",
            highlightIds.has(student.id) && "bg-ball font-bold text-ball-ink",
          )}
        >
          {student.nombre}
        </span>
      ))}
      {rest > 0 ? (
        <button
          type="button"
          onClick={onExpand}
          className="rounded-[6px] px-1.5 py-0.5 text-[12.5px] font-semibold text-ink-3 underline underline-offset-2 hover:text-ink"
        >
          +{rest} más
        </button>
      ) : null}
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
  const [expandedRungs, setExpandedRungs] = useState<ReadonlySet<number>>(new Set());
  const highlighted = highlightIds ?? new Set<string>();

  // Sorted here rather than trusted from the caller: reading order IS rank
  // order on this screen, so it is not something a call site gets to get wrong.
  const ordered = [...rungs].sort((a, b) => a.numeroNivel - b.numeroNivel);
  const lastIndex = ordered.length - 1;

  function expandRoster(nivelId: number): void {
    setExpandedRungs((prev) => new Set(prev).add(nivelId));
  }

  return (
    <ol className={cn("flex flex-col", className)}>
      {ordered.map((rung, index) => {
        const isFirst = index === 0;
        const isLast = index === lastIndex;
        const isOpen = openNivelId === rung.id;
        const count = rung.students.length;
        const hasMatch = rung.students.some((student) => highlighted.has(student.id));

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

              {/* The club's own name for the rung, and the only number on it. */}
              <span
                title={rung.nombre}
                className="w-20 flex-none truncate text-sm font-bold text-ink"
              >
                {rung.nombre}
              </span>

              <span className="min-w-[150px] flex-1">
                <RosterNames
                  students={rung.students}
                  expanded={expandedRungs.has(rung.id) || hasMatch}
                  onExpand={() => expandRoster(rung.id)}
                  highlightIds={highlighted}
                />
              </span>

              {/* The countable version of the roster. Visually redundant with
                  the names, but a screen reader gets the number outright. */}
              <span className="sr-only">
                {count === 1 ? "1 estudiante" : `${count} estudiantes`}
              </span>

              <Button
                size="sm"
                // `ml-auto` only bites when the row wraps on a narrow screen:
                // the action stays at the right edge instead of dropping onto
                // the rail it would otherwise sit on top of.
                className="ml-auto flex-none"
                onClick={() => onAssign(rung.id)}
                aria-expanded={isOpen}
                aria-label={`Asignar estudiantes al nivel ${rung.nombre}`}
              >
                Asignar estudiantes
              </Button>
            </div>

            {isOpen && renderPanel ? renderPanel(rung.id) : null}
          </li>
        );
      })}
    </ol>
  );
}
