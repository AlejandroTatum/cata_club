import { Users } from "lucide-react";
import { ICON } from "@/lib/icon-size";
import { EmptyState, PAGE_RAIL } from "@/components/ui";
import type { TrainingSchedule } from "@/app/attendance/attendance-utils";
import type { EstadoAsistencia } from "@/types/domain";
import AttendanceCorrectionRow, { type CorrectionPatch } from "./CorrectionRow";
import ReadOnlyReasonNotice from "./ReadOnlyReasonNotice";
import RosterProgressHeader from "./RosterProgressHeader";
import AttendanceRosterList from "./AttendanceRosterList";
import FilteredRosterEmptyState from "./FilteredRosterEmptyState";
import { clubIsoDate } from "@/lib/club-date";
import { useCorrectionRequests } from "./useCorrectionRequests";
import { isFiled, type SessionStudent } from "./attendance-utils";

interface MarkAttendanceStepProps {
  selectedSchedule: TrainingSchedule | null;
  readOnly: boolean;
  /** ENT-03/ENT-04: some students already have a row — only the rest are editable. */
  partialSession?: boolean;
  students: SessionStudent[];
  sessionDate: string | null;
  isAdmin: boolean;
  onRowCorrected: (personaId: string, patch: CorrectionPatch) => void;
  reviewedCount: number;
  unreviewedCount: number;
  onMarkRemainingPresent: () => void;
  restoredFromDraft: boolean;
  filteredStudents: SessionStudent[];
  searchFilter: string;
  onSearchFilterChange: (value: string) => void;
  onlyUnreviewed: boolean;
  onToggleOnlyUnreviewed: () => void;
  onShowAllStudents: () => void;
  onCycleAttendance: (studentIndex: number) => void;
  onDirectAttendanceSet: (studentIndex: number, state: EstadoAsistencia) => void;
  onRadioKeyDown: (
    e: React.KeyboardEvent<HTMLButtonElement>,
    studentIndex: number,
    state: EstadoAsistencia,
  ) => void;
  /** The stacked commit bar, hosted in the aside under the progress card. */
  commitBar: React.ReactNode;
  heading: string;
}

/** Step 2: the roll call itself. See `TrainerAttendancePage`'s own notes on this step. */
export default function MarkAttendanceStep({
  selectedSchedule,
  readOnly,
  partialSession = false,
  students,
  sessionDate,
  isAdmin,
  onRowCorrected,
  reviewedCount,
  unreviewedCount,
  onMarkRemainingPresent,
  restoredFromDraft,
  filteredStudents,
  searchFilter,
  onSearchFilterChange,
  onlyUnreviewed,
  onToggleOnlyUnreviewed,
  onShowAllStudents,
  onCycleAttendance,
  onDirectAttendanceSet,
  onRadioKeyDown,
  commitBar,
  heading,
}: MarkAttendanceStepProps): React.ReactElement | null {
  // QA4 ENT-25: a trainer on a closed list sees the outcome of their requests.
  const canRequestCorrection = readOnly && !isAdmin;
  const { requests, addRequest } = useCorrectionRequests(
    selectedSchedule?.id ?? null,
    sessionDate ?? clubIsoDate(),
    canRequestCorrection && selectedSchedule !== null,
  );

  if (!selectedSchedule) return null;

  const headingEl = (
    <h2 className="font-display text-lg uppercase leading-tight tracking-flat text-ink">{heading}</h2>
  );

  // A session that already has a row is closed for everyone now (issue
  // #389): the roster renders read-only, with the reason up front — no
  // radios, no fiche taps, no bulk action.
  if (readOnly) {
    return (
      <div className={PAGE_RAIL}>
        <div className="card flex flex-col gap-4 p-5 sm:p-6">
          {headingEl}
          <ReadOnlyReasonNotice canRequestCorrection={canRequestCorrection} />
          <ul className="flex flex-col gap-2" aria-label="Asistencia registrada (solo lectura)">
            {students.map((student) => (
              <AttendanceCorrectionRow
                key={student.id}
                student={student}
                sessionDate={sessionDate ?? clubIsoDate()}
                canCorrect={isAdmin}
                onCorrected={onRowCorrected}
                canRequestCorrection={canRequestCorrection}
                requests={requests}
                onRequestCreated={addRequest}
              />
            ))}
          </ul>
        </div>
        <aside className="flex flex-col gap-page lg:sticky lg:top-4">{commitBar}</aside>
      </div>
    );
  }

  const filedStudents = partialSession ? students.filter(isFiled) : [];
  const pendingCount = students.length - filedStudents.length;
  const editableStudents = partialSession ? filteredStudents.filter((s) => !isFiled(s)) : filteredStudents;

  return (
    <div className={PAGE_RAIL}>
      <div data-dash-col className="card flex flex-col gap-4 p-5 sm:p-6">
        {headingEl}
        {partialSession && (
          <div
            role="status"
            className="rounded-ctl border border-state-warn/30 bg-state-warn-bg p-4 text-sm text-state-warn"
          >
            <p className="font-semibold">Esta lista está incompleta.</p>
            <p>
              {filedStudents.length} de {students.length} alumnos ya tienen asistencia registrada y no
              se pueden cambiar desde aquí. Complete solo a{" "}
              {pendingCount === 1 ? "el alumno que falta" : `los ${pendingCount} alumnos que faltan`}.
            </p>
          </div>
        )}
        {restoredFromDraft && (
          <p className="rounded-ctl border border-line bg-canvas px-3.5 py-2.5 text-xs text-ink-2">
            Recuperamos las marcas que ya había hecho en esta sesión. Revíselas antes de continuar.
          </p>
        )}

        {students.length === 0 ? (
          <EmptyState
            icon={<Users size={ICON.lg} strokeWidth={1.5} aria-hidden="true" />}
            title="Este horario no tiene alumnos asignados."
            description="Pida a administración que asigne alumnos a este horario para poder tomar lista."
          />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                placeholder="Filtrar alumnos por nombre…"
                value={searchFilter}
                onChange={(e) => onSearchFilterChange(e.target.value)}
                aria-label="Filtrar alumnos"
                className="h-ctl min-w-[180px] flex-1 rounded-ctl border border-line-2 bg-paper px-[13px] text-sm text-ink placeholder:text-ink-3 focus:border-cata-red focus:outline-none"
              />
              {(unreviewedCount > 0 || onlyUnreviewed) && (
                <button
                  type="button"
                  onClick={onToggleOnlyUnreviewed}
                  aria-pressed={onlyUnreviewed}
                  className={`inline-flex h-ctl shrink-0 items-center gap-2 rounded-ctl border px-4 text-sm font-semibold transition-colors ${
                    onlyUnreviewed
                      ? "border-coal bg-coal text-white"
                      : "border-line-2 bg-paper text-ink-2 hover:border-ink-3 hover:text-ink"
                  }`}
                >
                  Ver solo sin revisar
                  <span className="tabular-nums">({unreviewedCount})</span>
                </button>
              )}
            </div>

            {editableStudents.length === 0 ? (
              <FilteredRosterEmptyState
                onlyUnreviewed={onlyUnreviewed}
                unreviewedCount={unreviewedCount}
                onShowAll={onShowAllStudents}
                onClearSearch={() => onSearchFilterChange("")}
              />
            ) : (
              <AttendanceRosterList
                students={students}
                filteredStudents={editableStudents}
                sessionDate={sessionDate}
                onCycleAttendance={onCycleAttendance}
                onDirectAttendanceSet={onDirectAttendanceSet}
                onRadioKeyDown={onRadioKeyDown}
              />
            )}
            {filedStudents.length > 0 && (
              <ul className="flex flex-col gap-2" aria-label="Ya registrados (solo lectura)">
                {filedStudents.map((student) => (
                  <AttendanceCorrectionRow
                    key={student.id}
                    student={student}
                    sessionDate={sessionDate ?? clubIsoDate()}
                    canCorrect={isAdmin}
                    onCorrected={onRowCorrected}
                  />
                ))}
              </ul>
            )}
          </>
        )}
      </div>

      <aside
        data-dash-col
        className="flex flex-col gap-page lg:sticky lg:top-4"
        aria-label="Progreso de la lista"
      >
        <div className="card overflow-hidden">
          <RosterProgressHeader
            selectedSchedule={selectedSchedule}
            reviewedCount={reviewedCount}
            totalCount={students.length}
            unreviewedCount={unreviewedCount}
            onMarkRemainingPresent={onMarkRemainingPresent}
          />
          <div className="p-5 max-lg:p-0 max-lg:pt-3">{commitBar}</div>
        </div>
      </aside>
    </div>
  );
}
