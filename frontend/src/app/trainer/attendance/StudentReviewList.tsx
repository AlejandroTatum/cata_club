import { ATTENDANCE_STATUS_CHART_COLORS } from "@/app/dashboard/dashboard-utils";
import { getUserInitials } from "@/lib/auth-utils";
import type { EstadoAsistencia } from "@/types/domain";
import { ATTENDANCE_LABELS, isReviewed, type SessionStudent } from "./attendance-utils";

export const STATE_DISPLAY_ORDER: EstadoAsistencia[] = [
  "present",
  "late",
  "justified",
  "sick",
  "competition",
  "absent",
];

/** Above this many students the list splits into two columns from `lg`. */
const TWO_COLUMN_FROM = 6;

/**
 * Six compact tiles, one per state. A state nobody is in stays in place (the
 * row keeps its shape) but shrinks and mutes, so the eye lands on the counts
 * that matter.
 */
export function StatusTiles({
  counts,
  className = "",
}: {
  counts: Record<EstadoAsistencia, number>;
  className?: string;
}): React.ReactElement {
  return (
    <ul className={`flex flex-wrap gap-2 ${className}`} aria-label="Conteo por estado">
      {STATE_DISPLAY_ORDER.map((state) => {
        const count = counts[state];
        const empty = count === 0;
        return (
          <li
            key={state}
            className={`flex items-center gap-2 rounded-ctl border px-3 ${
              empty
                ? "flex-none border-line bg-transparent py-1.5 text-ink-3"
                : "min-w-[112px] flex-1 border-line-2 bg-paper py-2.5 text-ink"
            }`}
          >
            <span
              aria-hidden="true"
              className="h-2.5 w-2.5 flex-none rounded-[3px]"
              style={{ backgroundColor: ATTENDANCE_STATUS_CHART_COLORS[state], opacity: empty ? 0.4 : 1 }}
            />
            <span className={`font-extrabold tabular-nums ${empty ? "text-sm" : "text-xl leading-none"}`}>
              {count}
            </span>
            <span className={`font-semibold ${empty ? "text-xs" : "text-xs text-ink-2"}`}>
              {ATTENDANCE_LABELS[state]}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The full roster, one dense row per student: initials, name, state chip and
 * the justificativo when there is one. Nothing is hidden behind a group, so the
 * trainer reviews (or remembers) every student, not just the ones in a state.
 */
export default function StudentReviewList({
  students,
  flagUnreviewed = false,
  className = "",
}: {
  students: SessionStudent[];
  /** Draw rows nobody has reviewed yet with a dashed outline (step 3 only). */
  flagUnreviewed?: boolean;
  className?: string;
}): React.ReactElement {
  const twoColumns = students.length > TWO_COLUMN_FROM;
  return (
    <ul
      aria-label="Asistencia por alumno"
      className={`grid content-start gap-2 ${twoColumns ? "lg:grid-cols-2" : ""} ${className}`}
    >
      {students.map((student) => {
        const state = student.attendance as EstadoAsistencia;
        const unreviewed = flagUnreviewed && !isReviewed(student);
        return (
          <li
            key={student.id}
            className={`flex min-w-0 items-center gap-3 rounded-ctl border bg-paper px-3 py-2 ${
              unreviewed ? "border-dashed border-ink-3/60" : "border-line"
            }`}
          >
            <span
              aria-hidden="true"
              className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-canvas text-2xs font-bold text-ink-2"
            >
              {getUserInitials(student.name)}
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="break-words text-sm font-semibold text-ink" title={student.name}>
                {student.name}
              </span>
              {student.justificativo && (
                <span className="break-words text-xs text-ink-3" title={student.justificativo}>
                  {student.justificativo}
                </span>
              )}
            </span>
            {unreviewed && <span className="flex-none text-2xs font-bold text-state-warn">Sin revisar</span>}
            <span className="flex flex-none items-center gap-1.5 rounded-full border border-line bg-canvas px-2.5 py-1 text-xs font-semibold text-ink-2">
              <span
                aria-hidden="true"
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: ATTENDANCE_STATUS_CHART_COLORS[state] }}
              />
              {ATTENDANCE_LABELS[state]}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
