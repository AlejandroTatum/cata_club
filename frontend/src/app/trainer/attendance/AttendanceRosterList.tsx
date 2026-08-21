import type { EstadoAsistencia } from "@/types/domain";
import type { SessionStudent } from "./attendance-utils";
import AttendanceRosterRow from "./AttendanceRosterRow";

interface AttendanceRosterListProps {
  /** The FULL roster — `studentIndex` is resolved against this, not the filtered view. */
  students: SessionStudent[];
  filteredStudents: SessionStudent[];
  onCycleAttendance: (studentIndex: number) => void;
  onDirectAttendanceSet: (studentIndex: number, state: EstadoAsistencia) => void;
  onRadioKeyDown: (
    e: React.KeyboardEvent<HTMLButtonElement>,
    studentIndex: number,
    state: EstadoAsistencia,
  ) => void;
}

/**
 * Issue #318/#25 (K9), desktop only: its own bounded, internally-scrolling
 * box, so the page itself never scrolls past the `sticky bottom-0` commit
 * bar — see `TrainerAttendancePage`'s own note on why padding cannot fix
 * this.
 */
export default function AttendanceRosterList({
  students,
  filteredStudents,
  onCycleAttendance,
  onDirectAttendanceSet,
  onRadioKeyDown,
}: AttendanceRosterListProps): React.ReactElement {
  return (
    <ul
      data-testid="attendance-roster-scroll"
      className="flex flex-col gap-2 sm:max-h-[calc(100vh-660px)] sm:min-h-[120px] sm:overflow-y-auto sm:overscroll-contain sm:pr-1"
    >
      {filteredStudents.map((student) => (
        <AttendanceRosterRow
          key={student.id}
          student={student}
          studentIndex={students.findIndex((s) => s.id === student.id)}
          onCycleAttendance={onCycleAttendance}
          onDirectAttendanceSet={onDirectAttendanceSet}
          onRadioKeyDown={onRadioKeyDown}
        />
      ))}
    </ul>
  );
}
