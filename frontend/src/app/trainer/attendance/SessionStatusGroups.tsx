import { ATTENDANCE_STATUS_CHART_COLORS } from "@/app/dashboard/dashboard-utils";
import { formatStateCount } from "@/app/trainer/trainer-day-utils";
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

interface SessionStatusGroupsProps {
  students: SessionStudent[];
  /** Draw rows nobody has reviewed yet with a dashed outline (step 3 only). */
  flagUnreviewed?: boolean;
  className?: string;
}

/**
 * Who is in each state. Statuses nobody is in are NOT listed as zero rows:
 * they collapse into one muted line, so the eye lands on the groups that hold
 * names. Names are chips, so a group of twenty reads as a block, not a column
 * stretched across the page.
 */
export default function SessionStatusGroups({
  students,
  flagUnreviewed = false,
  className = "",
}: SessionStatusGroupsProps): React.ReactElement {
  const groups = STATE_DISPLAY_ORDER.map((state) => ({
    state,
    members: students.filter((s) => s.attendance === state),
  }));
  const filled = groups.filter((g) => g.members.length > 0);
  const empty = groups.filter((g) => g.members.length === 0);

  return (
    <div className={`grid content-start gap-x-8 gap-y-5 sm:grid-cols-2 ${className}`}>
      {filled.map(({ state, members }) => (
        <section key={state} aria-label={ATTENDANCE_LABELS[state]} className="flex flex-col gap-2">
          <h3 className="flex items-center gap-2 text-sm font-bold text-ink">
            <span
              aria-hidden="true"
              className="h-2.5 w-2.5 flex-none rounded-[3px]"
              style={{ backgroundColor: ATTENDANCE_STATUS_CHART_COLORS[state] }}
            />
            {ATTENDANCE_LABELS[state]}
            <span className="text-xs font-semibold tabular-nums text-ink-3">{members.length}</span>
          </h3>
          <ul className="flex flex-wrap gap-1.5">
            {members.map((member) => (
              <li
                key={member.id}
                className={`rounded-full border bg-canvas px-2.5 py-1 text-xs font-medium text-ink-2 ${
                  flagUnreviewed && !isReviewed(member) ? "border-dashed border-ink-3/60" : "border-line"
                }`}
              >
                {member.name}
              </li>
            ))}
          </ul>
        </section>
      ))}
      {empty.length > 0 && filled.length > 0 && (
        <p className="border-t border-line pt-3 text-xs text-ink-3 sm:col-span-2">
          Sin {empty.map((g) => formatStateCount(g.state, 0).replace(/^0 /, "")).join(", ")}.
        </p>
      )}
    </div>
  );
}
