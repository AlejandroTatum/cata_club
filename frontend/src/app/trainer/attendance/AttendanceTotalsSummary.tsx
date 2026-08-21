import { formatStateCount } from "@/app/trainer/trainer-day-utils";
import { countByState, type SessionStudent } from "./attendance-utils";
import type { EstadoAsistencia } from "@/types/domain";

const TOTAL_ORDER: EstadoAsistencia[] = ["present", "late", "justified", "absent"];

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
    <span className="flex min-w-[250px] flex-1 flex-wrap gap-x-3 gap-y-field text-xs text-ink-3">
      {TOTAL_ORDER.map((state) => (
        <span key={state} className="whitespace-nowrap">
          {formatStateCount(state, countByState(students, state))}
        </span>
      ))}
      {unreviewedCount > 0 && (
        <span className="whitespace-nowrap font-bold text-state-warn">{`${unreviewedCount} sin revisar`}</span>
      )}
    </span>
  );
}
