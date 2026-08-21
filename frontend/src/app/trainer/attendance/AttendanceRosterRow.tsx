import { FileText, Timer, UserCheck, UserX } from "lucide-react";
import { ICON } from "@/lib/icon-size";
import { Badge } from "@/components/ui";
import { getAttendanceBadgeTone, getAttendanceBadgeTokens } from "@/app/attendance/attendance-utils";
import { getUserInitials } from "@/lib/auth-utils";
import type { EstadoAsistencia } from "@/types/domain";
import { ATTENDANCE_LABELS, ATTENDANCE_STATES, UNMARKED, isReviewed, type SessionStudent } from "./attendance-utils";

const ATTENDANCE_ICONS: Record<EstadoAsistencia, React.ReactNode> = {
  present: <UserCheck size={ICON.sm} strokeWidth={2} aria-hidden="true" />,
  absent: <UserX size={ICON.sm} strokeWidth={2} aria-hidden="true" />,
  late: <Timer size={ICON.sm} strokeWidth={2} aria-hidden="true" />,
  justified: <FileText size={ICON.sm} strokeWidth={2} aria-hidden="true" />,
};

interface AttendanceRosterRowProps {
  student: SessionStudent;
  studentIndex: number;
  onCycleAttendance: (studentIndex: number) => void;
  onDirectAttendanceSet: (studentIndex: number, state: EstadoAsistencia) => void;
  onRadioKeyDown: (
    e: React.KeyboardEvent<HTMLButtonElement>,
    studentIndex: number,
    state: EstadoAsistencia,
  ) => void;
}

/**
 * One fiche: 48px, avatar + name + state, and the whole surface is the tap
 * target — plus the four-state radiogroup, the deliberate path. Isolated on
 * its own because it is the single densest piece of the roll call's markup
 * (issue #318/#25's `overflow-y-auto` box only needed `shrink-0` fixed here).
 */
export default function AttendanceRosterRow({
  student,
  studentIndex,
  onCycleAttendance,
  onDirectAttendanceSet,
  onRadioKeyDown,
}: AttendanceRosterRowProps): React.ReactElement {
  const isUnmarked = student.attendance === UNMARKED;
  const reviewed = isReviewed(student);
  const nameId = `student-name-${student.id}`;
  const groupLabelId = `attendance-label-${student.id}`;
  const stateLabel = isUnmarked ? "Sin marcar" : ATTENDANCE_LABELS[student.attendance as EstadoAsistencia];

  return (
    <li
      data-attendance={student.attendance}
      data-reviewed={reviewed}
      className={`flex shrink-0 flex-col overflow-hidden rounded-ctl border bg-paper sm:h-12 sm:flex-row sm:items-center ${
        reviewed ? "border-line-2" : "border-dashed border-ink-3/50"
      }`}
    >
      <button
        type="button"
        onClick={() => onCycleAttendance(studentIndex)}
        aria-label={
          reviewed
            ? `${student.name}: ${stateLabel}. Cambiar estado`
            : `${student.name}: ${stateLabel}, sin revisar. Confirmar o cambiar estado`
        }
        className="flex h-12 w-full min-w-0 shrink-0 items-center gap-[11px] px-[13px] text-left transition-colors hover:bg-canvas sm:w-auto sm:flex-1"
      >
        <span
          aria-hidden="true"
          className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-state-neutral-bg text-2xs tracking-flat font-bold text-state-neutral"
        >
          {getUserInitials(student.name)}
        </span>
        <span id={nameId} className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">
          {student.name}
        </span>
        {reviewed && !isUnmarked ? (
          <Badge tone={getAttendanceBadgeTone(student.attendance)} className="flex-none">
            {stateLabel}
          </Badge>
        ) : (
          <span className="h-badge inline-flex flex-none items-center rounded-full border border-dashed border-line-2 px-[11px] text-2xs tracking-flat font-bold text-ink-3">
            {stateLabel}
          </span>
        )}
      </button>

      <div
        role="radiogroup"
        aria-labelledby={`${groupLabelId} ${nameId}`}
        className="grid w-full grid-cols-4 gap-0.5 border-t border-line p-1 sm:h-full sm:w-auto sm:border-l sm:border-t-0 sm:p-0.5"
      >
        <span id={groupLabelId} className="sr-only">
          Estado de asistencia de
        </span>
        {ATTENDANCE_STATES.map((state) => {
          const isActive = student.attendance === state;
          return (
            <button
              key={state}
              type="button"
              role="radio"
              onClick={() => onDirectAttendanceSet(studentIndex, state)}
              tabIndex={isActive ? 0 : -1}
              onKeyDown={(e) => onRadioKeyDown(e, studentIndex, state)}
              aria-checked={isActive}
              title={ATTENDANCE_LABELS[state]}
              data-state={state}
              /* @touch-target Marked standing up, phone in hand — 44px at
                 every width, not only below `lg`. */
              className={`inline-flex min-h-[44px] min-w-[44px] flex-col items-center justify-center gap-0.5 rounded-lg border px-1 text-2xs tracking-flat font-semibold leading-tight transition-colors ${
                isActive
                  ? `border-transparent ${getAttendanceBadgeTokens(state).badgeClass}`
                  : "border-transparent text-ink-3 hover:bg-canvas hover:text-ink"
              }`}
            >
              {ATTENDANCE_ICONS[state]}
              {/* hallazgo #24: escondido desde 640px (`sm:sr-only`), visible
                  desde `lg` (1024px), donde la ficha ya no es una columna
                  angosta. */}
              <span className="sr-only lg:not-sr-only">{ATTENDANCE_LABELS[state]}</span>
            </button>
          );
        })}
      </div>
    </li>
  );
}
