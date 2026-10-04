import { Thermometer, Timer, Trophy, UserCheck, UserX } from "lucide-react";
import { ICON } from "@/lib/icon-size";
import { Badge } from "@/components/ui";
import { getAttendanceBadgeTone, getAttendanceBadgeTokens } from "@/app/attendance/attendance-utils";
import { getUserInitials } from "@/lib/auth-utils";
import type { EstadoAsistencia } from "@/types/domain";
import {
  ATTENDANCE_LABELS,
  ATTENDANCE_STATES,
  UNMARKED,
  isBeforeEnrollment,
  isReviewed,
  type SessionStudent,
} from "./attendance-utils";

const ATTENDANCE_ICONS: Record<EstadoAsistencia, React.ReactNode> = {
  present: <UserCheck size={ICON.sm} strokeWidth={2} aria-hidden="true" />,
  absent: <UserX size={ICON.sm} strokeWidth={2} aria-hidden="true" />,
  late: <Timer size={ICON.sm} strokeWidth={2} aria-hidden="true" />,
  // Issue #1373: inasistencias autorizadas, cada una con su ícono propio
  // para que el toggle no dependa solo del color del badge.
  sick: <Thermometer size={ICON.sm} strokeWidth={2} aria-hidden="true" />,
  competition: <Trophy size={ICON.sm} strokeWidth={2} aria-hidden="true" />,
};

interface AttendanceRosterRowProps {
  student: SessionStudent;
  studentIndex: number;
  /** The session's day — a date before the student's enrolment gets a notice (ENT-07). */
  sessionDate?: string | null;
  onCycleAttendance: (studentIndex: number) => void;
  onDirectAttendanceSet: (studentIndex: number, state: EstadoAsistencia) => void;
  onRadioKeyDown: (
    e: React.KeyboardEvent<HTMLButtonElement>,
    studentIndex: number,
    state: EstadoAsistencia,
  ) => void;
}

/**
 * One fiche: avatar + name + state, and the whole surface is the tap target
 * — plus the six-state radiogroup, the deliberate path. Isolated on its own
 * because it is the single densest piece of the roll call's markup (issue
 * #318/#25's `overflow-y-auto` box only needed `shrink-0` fixed here).
 *
 * The row's height is CONTENT-DRIVEN at every breakpoint (#1373): no fixed
 * height may fight the picker. The picker itself wraps 3-wide (3+2 of 44px
 * targets) below `lg`, and from `lg` up — where the fiche is wide — all five
 * states sit in ONE horizontal row (`lg:grid-cols-5`, user feedback on the
 * #1373 preview: the desktop 2×3 block made rows read as too tall).
 * `overflow-hidden` stays only as the rounded-corner clip for the name
 * button's hover surface — harmless once no fixed height can fight the grid.
 */
export default function AttendanceRosterRow({
  student,
  studentIndex,
  sessionDate = null,
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
      className={`flex shrink-0 flex-col overflow-hidden rounded-ctl border bg-paper sm:flex-row sm:items-center ${
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
        className="flex min-h-12 w-full min-w-0 shrink-0 items-center gap-[11px] px-[13px] py-1.5 text-left transition-colors hover:bg-canvas sm:w-auto sm:flex-1"
      >
        <span
          aria-hidden="true"
          className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-state-neutral-bg text-2xs tracking-flat font-bold text-state-neutral"
        >
          {getUserInitials(student.name)}
        </span>
        {/* ENT-01: the notice sits UNDER the name, in the same column. As a
            sibling chip it squeezed the name to width 0 at 390px. The name takes
            the full width and wraps instead of truncating. */}
        <span className="flex min-w-0 flex-1 flex-col items-start gap-0.5">
          <span id={nameId} className="break-words text-sm font-semibold text-ink">
            {student.name}
          </span>
          {isBeforeEnrollment(student, sessionDate) && (
            // ENT-07: allowed, but flagged for the admin's review once saved.
            // The detail is visible text: a `title` never shows on a phone.
            <>
              <Badge tone="warn">Anterior a su inscripción</Badge>
              <span className="text-2xs font-normal text-ink-3">
                Se registrará y quedará marcada para revisión.
              </span>
            </>
          )}
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
        className="grid w-full grid-cols-3 gap-0.5 border-t border-line p-1 sm:h-full sm:w-auto sm:border-l sm:border-t-0 sm:p-0.5 lg:grid-cols-5"
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
              {/* Visible at every width: icon-only controls were unreadable on a
                  phone. Below `lg` they sit in a 3x2 grid of labeled 44px targets. */}
              <span>{ATTENDANCE_LABELS[state]}</span>
            </button>
          );
        })}
      </div>
    </li>
  );
}
