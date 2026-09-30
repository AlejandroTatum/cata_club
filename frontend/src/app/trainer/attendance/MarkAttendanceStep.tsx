import { Users } from "lucide-react";
import { ICON } from "@/lib/icon-size";
import { Badge, EmptyState, PAGE_RAIL } from "@/components/ui";
import ContextualHelp from "@/components/ContextualHelp";
import { getAttendanceBadgeTone } from "@/app/attendance/attendance-utils";
import type { TrainingSchedule } from "@/app/attendance/attendance-utils";
import type { EstadoAsistencia } from "@/types/domain";
import AttendanceCorrectionRow, { type CorrectionPatch } from "./CorrectionRow";
import ReadOnlyReasonNotice from "./ReadOnlyReasonNotice";
import RosterProgressHeader from "./RosterProgressHeader";
import AttendanceRosterList from "./AttendanceRosterList";
import FilteredRosterEmptyState from "./FilteredRosterEmptyState";
import { clubIsoDate } from "@/lib/club-date";
import { ATTENDANCE_LABELS, type SessionStudent } from "./attendance-utils";

const TOTAL_ORDER: EstadoAsistencia[] = ["present", "late", "justified", "sick", "competition", "absent"];

const ATTENDANCE_DEFINITIONS: Record<EstadoAsistencia, string> = {
  present: "asistió a la clase.",
  late: "asistió, pero llegó después de que empezó.",
  justified: "no asistió, pero avisó un motivo que el club aceptó — se registra aparte de una ausencia.",
  // Issue #1373: inasistencias autorizadas — conocidas del lado del club,
  // nunca ausencias injustificadas.
  sick: "no asistió por enfermedad — inasistencia autorizada, no cuenta como ausencia injustificada.",
  competition:
    "no asistió por competencia deportiva — convocatoria oficial, no cuenta como ausencia injustificada.",
  absent: "no asistió y no hay motivo aceptado.",
};

interface MarkAttendanceStepProps {
  selectedSchedule: TrainingSchedule | null;
  readOnly: boolean;
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
          <ReadOnlyReasonNotice />
          <ul className="flex flex-col gap-2" aria-label="Asistencia registrada (solo lectura)">
            {students.map((student) => (
              <AttendanceCorrectionRow
                key={student.id}
                student={student}
                sessionDate={sessionDate ?? clubIsoDate()}
                canCorrect={isAdmin}
                onCorrected={onRowCorrected}
              />
            ))}
          </ul>
        </div>
        <aside className="flex flex-col gap-page lg:sticky lg:top-4">{commitBar}</aside>
      </div>
    );
  }

  return (
    <div className={PAGE_RAIL}>
      <div data-dash-col className="card flex flex-col gap-4 p-5 sm:p-6">
        {headingEl}
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
            {/* D11c: the subtitle says WHAT this is, and everything that
              explains HOW it works goes behind "Ver ayuda". */}
            <ContextualHelp title="Cómo funciona pasar lista">
              <p className="mb-2">
                Toque la ficha de un alumno para confirmar o cambiar su estado, o use los cuatro botones de la
                derecha para elegirlo directamente. Los cuatro estados son:
              </p>
              <div className="flex flex-wrap items-center gap-2">
                {TOTAL_ORDER.map((state) => (
                  <Badge key={state} tone={getAttendanceBadgeTone(state)}>
                    {ATTENDANCE_LABELS[state]}
                  </Badge>
                ))}
              </div>
              <ul className="mt-2 flex flex-col gap-1">
                {TOTAL_ORDER.map((state) => (
                  <li key={state}>{`${ATTENDANCE_LABELS[state]}: ${ATTENDANCE_DEFINITIONS[state]}`}</li>
                ))}
              </ul>
              <p className="mt-2">
                Una ficha con borde punteado y el estado{" "}
                <span className="h-badge inline-flex items-center rounded-full border border-dashed border-line-2 px-[11px] text-2xs tracking-flat font-bold text-ink-3">
                  Sin revisar
                </span>{" "}
                sigue en el valor por defecto porque todavía nadie la miró.
              </p>
            </ContextualHelp>

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

            {filteredStudents.length === 0 ? (
              <FilteredRosterEmptyState
                onlyUnreviewed={onlyUnreviewed}
                unreviewedCount={unreviewedCount}
                onShowAll={onShowAllStudents}
                onClearSearch={() => onSearchFilterChange("")}
              />
            ) : (
              <AttendanceRosterList
                students={students}
                filteredStudents={filteredStudents}
                onCycleAttendance={onCycleAttendance}
                onDirectAttendanceSet={onDirectAttendanceSet}
                onRadioKeyDown={onRadioKeyDown}
              />
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
