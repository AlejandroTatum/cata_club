/**
 * NivelLadder — "la escalera", the club's training ladder rendered as what it
 * actually is: an ordinal scale where 1 is the top and 10 the base.
 *
 * Transcribed from `docs/ux/prototipos/13-niveles.html:83-94` and the
 * `_sistema.css` rules it uses:
 *
 *   `.ladder` (:276)  column flex, no gap — the rows carry the rhythm
 *   `.rung`   (:277)  60px (`--h-row`), 20px side padding, 14px gap, a
 *                     `--line` bottom rule suppressed on the last rung
 *   `.rung::before`   (:279-281) the connecting rail: 2px of `--line` at
 *                     left:34px (20px padding + half of the 28px chip), cut
 *                     back 30px at the top of the first rung and 30px at the
 *                     bottom of the last one so it starts and ends at a chip
 *                     rather than running off the card
 *   `.lv`     (:282)  the rank chip — rendered through `LevelChip`, which owns
 *                     the l1–l10 ramp, plus the 4px `--paper` ring that makes
 *                     the chip punch a hole in the rail
 *   `.rung .nm` (:283) 96px fixed name column
 *   `.avs`    (:285-288) the -9px overlapped avatar stack, `+N` counter last
 *
 * Product rules this component exists to enforce (settled, not preferences):
 *   - 1 is the top of the ladder, 10 the base. The list is an `<ol>` and is
 *     sorted ascending so that reading order IS rank order.
 *   - NO occupancy anywhere: no meters, no "N/M" fractions, no minimum-headcount
 *     warning. `cuposDisponibles`/`necesitaRevision` exist in the API payload
 *     and deliberately never reach this component's props.
 *   - ONE action per rung: "Asignar". There is no "Promover".
 */

import type { ReactElement, ReactNode } from "react";
import { Button, LevelChip, cn, isLevel } from "@/components/ui";
import { getUserInitials } from "@/lib/auth-utils";

/** How many avatars a rung shows before collapsing the rest into `+N`. */
const MAX_AVATARS = 3;

export interface LadderStudent {
  id: string;
  /** Full display name — initials are derived from it. */
  nombre: string;
}

/**
 * One rung. Note what is NOT here: capacity, occupancy, headcount minimums.
 * The ladder shows who is on a rung, never how full it is.
 */
export interface LadderRung {
  /** `nivel_ranking.id` — the value the assign endpoints take. */
  id: number;
  /** The rank. 1 is the top. */
  numeroNivel: number;
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
  className?: string;
}

/** The overlapped initials stack — `_sistema.css` `.avs` (:285-288). */
function AvatarStack({ students }: { students: LadderStudent[] }): ReactElement | null {
  if (students.length === 0) return null;

  const shown = students.slice(0, MAX_AVATARS);
  const rest = students.length - shown.length;
  const disc =
    "flex h-7 w-7 flex-none items-center justify-center rounded-full border-2 " +
    "text-[10px] font-bold -ml-[9px] first:ml-0";

  return (
    <span
      className="flex"
      // The stack is decorative shorthand for the roster; the rung's
      // accessible summary below carries the real, countable information.
      aria-hidden="true"
    >
      {shown.map((student) => (
        <span
          key={student.id}
          title={student.nombre}
          className={cn(disc, "border-paper bg-state-neutral-bg text-state-neutral")}
        >
          {getUserInitials(student.nombre)}
        </span>
      ))}
      {rest > 0 ? (
        <span className={cn(disc, "border-line-2 bg-paper text-ink-3")}>+{rest}</span>
      ) : null}
    </span>
  );
}

export default function NivelLadder({
  rungs,
  onAssign,
  openNivelId = null,
  renderPanel,
  className,
}: NivelLadderProps): ReactElement {
  // Sorted here rather than trusted from the caller: reading order IS rank
  // order on this screen, so it is not something a call site gets to get wrong.
  const ordered = [...rungs].sort((a, b) => a.numeroNivel - b.numeroNivel);

  return (
    <ol className={cn("flex flex-col", className)}>
      {ordered.map((rung, index) => {
        const isFirst = index === 0;
        const isLast = index === ordered.length - 1;
        const count = rung.students.length;

        return (
          <li key={rung.id} className={cn("border-b border-line", isLast && "border-b-0")}>
            <div
              className={cn(
                "relative flex h-row items-center gap-3.5 px-5",
                // The rail. `content-['']` is what makes the pseudo-element real.
                "before:absolute before:left-[34px] before:w-0.5 before:bg-line before:content-['']",
                isFirst ? "before:top-[30px]" : "before:top-0",
                isLast ? "before:bottom-[30px]" : "before:bottom-0",
              )}
            >
              {isLevel(rung.numeroNivel) ? (
                <LevelChip
                  level={rung.numeroNivel}
                  // "Puesto", not "Nivel": in the real data the club's level
                  // NAMES ("1A", "1B", "2", … "10") are not the same numbers as
                  // `numero_nivel` (1…11), because the top level is split in
                  // two. `numero_nivel` is the rank — the thing the l1–l10 ramp
                  // encodes — and the name beside the chip is what the club
                  // calls that rung. Labelling the chip "Nivel 3" next to a
                  // rung named "2" would assert something false.
                  label={`Puesto ${rung.numeroNivel} de la escalera`}
                  className="relative z-[1] ring-4 ring-paper"
                />
              ) : (
                // The ramp is defined for ten rungs only. A club that adds an
                // eleventh gets an honest neutral chip rather than a colour
                // invented on the spot.
                <span
                  title={`Puesto ${rung.numeroNivel} de la escalera`}
                  className="relative z-[1] flex h-7 w-7 flex-none items-center justify-center rounded-lg bg-state-neutral-bg text-xs font-extrabold text-state-neutral ring-4 ring-paper"
                >
                  {rung.numeroNivel}
                </span>
              )}

              <span
                title={rung.nombre}
                className="w-24 flex-none truncate text-sm font-semibold text-ink"
              >
                {rung.nombre}
              </span>

              <AvatarStack students={rung.students} />

              {/* The countable version of the avatar stack. Visually hidden
                  because the stack already says it, but a screen reader gets
                  the number instead of a row of initials. */}
              <span className="sr-only">
                {count === 1 ? "1 estudiante" : `${count} estudiantes`}
              </span>

              <span className="flex-1" />

              <Button
                size="sm"
                onClick={() => onAssign(rung.id)}
                aria-expanded={openNivelId === rung.id}
                aria-label={`Asignar estudiantes al nivel ${rung.nombre}`}
              >
                Asignar
              </Button>
            </div>

            {openNivelId === rung.id && renderPanel ? renderPanel(rung.id) : null}
          </li>
        );
      })}
    </ol>
  );
}
