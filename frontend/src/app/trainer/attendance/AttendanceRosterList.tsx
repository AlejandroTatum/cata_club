import type { EstadoAsistencia } from "@/types/domain";
import type { SessionStudent } from "./attendance-utils";
import AttendanceRosterRow from "./AttendanceRosterRow";

interface AttendanceRosterListProps {
  /** The FULL roster — `studentIndex` is resolved against this, not the filtered view. */
  students: SessionStudent[];
  filteredStudents: SessionStudent[];
  /** The session's day, for the "before enrolment" notice on each row (ENT-07). */
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
 * The roster uses the page's width: one row per student, two columns from
 * `2xl`. It no longer scrolls inside its own box — the commit bar is `sticky`
 * (mobile) or lives in the sticky aside (desktop), so the page itself can
 * scroll without ever losing the action (issue #318/#25, answered by layout).
 */
export default function AttendanceRosterList({
  students,
  filteredStudents,
  sessionDate = null,
  onCycleAttendance,
  onDirectAttendanceSet,
  onRadioKeyDown,
}: AttendanceRosterListProps): React.ReactElement {
  return (
    <ul
      data-testid="attendance-roster-scroll"
      className="grid gap-2"
    >
      {filteredStudents.map((student) => (
        <AttendanceRosterRow
          key={student.id}
          student={student}
          studentIndex={students.findIndex((s) => s.id === student.id)}
          sessionDate={sessionDate}
          onCycleAttendance={onCycleAttendance}
          onDirectAttendanceSet={onDirectAttendanceSet}
          onRadioKeyDown={onRadioKeyDown}
        />
      ))}
    </ul>
  );
}
