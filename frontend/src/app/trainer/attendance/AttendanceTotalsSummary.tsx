import { formatStateCount } from "@/app/trainer/trainer-day-utils";
import { ATTENDANCE_STATUS_CHART_COLORS } from "@/app/dashboard/dashboard-utils";
import { countByState, type SessionStudent } from "./attendance-utils";
import type { EstadoAsistencia } from "@/types/domain";

const TOTAL_ORDER: EstadoAsistencia[] = ["present", "late", "sick", "competition", "absent"];

interface AttendanceTotalsSummaryProps {
  students: SessionStudent[];
  unreviewedCount: number;
}

/**
 * Running totals for the commit bar — the same numbers step 3 shows, one
 * glance. `whitespace-nowrap` per item: the strip used to break INSIDE a
 * phrase at this width.
 */
export default function AttendanceTotalsSummary({
  students,
  unreviewedCount,
}: AttendanceTotalsSummaryProps): React.ReactElement {
  return (
    // ENT-14: below `lg` the strip is ONE short row — it takes the bar's full width
    // (first row) and shows only the states somebody is in; the zeros come back at `lg`.
    <span className="flex min-w-0 flex-1 flex-wrap gap-x-3 gap-y-0.5 text-xs text-ink-3 max-lg:order-first max-lg:basis-full lg:order-1 lg:flex-none lg:flex-col lg:gap-y-1.5 lg:text-sm">
      {TOTAL_ORDER.map((state) => {
        const count = countByState(students, state);
        return (
          <span
            key={state}
            className={`items-center gap-2 whitespace-nowrap ${count === 0 ? "max-lg:hidden lg:inline-flex lg:text-ink-3/60" : "inline-flex lg:font-semibold lg:text-ink"}`}
          >
            <span
              aria-hidden="true"
              className="hidden h-2.5 w-2.5 flex-none rounded-[3px] bg-line-2 lg:inline-block"
              style={{ backgroundColor: count === 0 ? undefined : ATTENDANCE_STATUS_CHART_COLORS[state] }}
            />
            {formatStateCount(state, count)}
          </span>
        );
      })}
      {unreviewedCount > 0 && (
        <span className="whitespace-nowrap font-bold text-state-warn">{`${unreviewedCount} sin revisar`}</span>
      )}
    </span>
  );
}
