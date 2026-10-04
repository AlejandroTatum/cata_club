import { AlertTriangle, UserCheck } from "lucide-react";
import { ICON } from "@/lib/icon-size";
import { Badge, Button, PAGE_RAIL } from "@/components/ui";
import { formatDay } from "@/app/attendance/attendance-utils";
import type { TrainingSchedule } from "@/app/attendance/attendance-utils";
import { SessionCompositionCounts } from "@/app/trainer/SessionComposition";
import type { EstadoAsistencia } from "@/types/domain";
import { formatSessionDateLabel, type SessionStudent } from "./attendance-utils";
import ReadOnlyReasonNotice from "./ReadOnlyReasonNotice";
import SessionDonut from "./SessionDonut";
import StudentReviewList, { StatusTiles } from "./StudentReviewList";

interface ConfirmationStepProps {
  selectedSchedule: TrainingSchedule | null;
  readOnly: boolean;
  students: SessionStudent[];
  sessionDate: string | null;
  confirmCounts: Record<EstadoAsistencia, number>;
  totalStudents: number;
  unreviewedCount: number;
  onReviewUnreviewed: () => void;
  onMarkRemainingPresent: () => void;
  submitError: string | null;
  /** The stacked commit bar (Atrás / Confirmar asistencia), hosted in the aside. */
  commitBar: React.ReactNode;
  heading: string;
}

/**
 * Step 3: review before filing. See `TrainerAttendancePage`'s own notes on this step.
 *
 * A review screen, not a form: the left column says WHO is in each state
 * (empty states collapse into one muted line), the aside holds the session
 * card — horario, fecha, the ring with its legend — and the two commitBar.
 */
export default function ConfirmationStep({
  selectedSchedule,
  readOnly,
  students,
  sessionDate,
  confirmCounts,
  totalStudents,
  unreviewedCount,
  onReviewUnreviewed,
  onMarkRemainingPresent,
  submitError,
  commitBar,
  heading,
}: ConfirmationStepProps): React.ReactElement | null {
  if (!selectedSchedule) return null;

  return (
    <div className={PAGE_RAIL}>
      <div data-dash-col className="card flex flex-col gap-5 p-5 sm:p-6">
        <h2 className="font-display text-lg uppercase leading-tight tracking-flat text-ink">{heading}</h2>

        {/* Defense in depth (issue #310/#3): the commit bar already disables
            "Revisar y confirmar" for a read-only session, so this step should
            not be reachable except through a direct `?paso=confirmar` link. */}
        {readOnly && <ReadOnlyReasonNotice />}

        {unreviewedCount > 0 && (
          /* Names the risk in the trainer's own terms and hands back the way
             to fix it — it does NOT block. */
          <div
            role="status"
            className="flex flex-col gap-3 rounded-ctl border border-state-warn/25 bg-state-warn-bg p-3.5"
          >
            <p className="flex items-start gap-2 text-sm font-semibold text-state-warn">
              <AlertTriangle size={ICON.sm} strokeWidth={2} className="mt-0.5 flex-none" aria-hidden="true" />
              <span>
                {unreviewedCount === 1
                  ? `1 de ${totalStudents} jugadores sigue en "Presente" porque nadie lo revisó.`
                  : `${unreviewedCount} de ${totalStudents} jugadores siguen en "Presente" porque nadie los revisó.`}
              </span>
            </p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={onReviewUnreviewed}>
                {unreviewedCount === 1 ? "Revisar a ese jugador" : `Revisar a esos ${unreviewedCount}`}
              </Button>
              <Button type="button" variant="tertiary" onClick={onMarkRemainingPresent}>
                <UserCheck size={ICON.sm} strokeWidth={2} aria-hidden="true" />
                Confirmar que están presentes
              </Button>
            </div>
          </div>
        )}

        <StatusTiles counts={confirmCounts} />
        <StudentReviewList students={students} flagUnreviewed />
      </div>

      <aside
        data-dash-col
        className="flex flex-col gap-page lg:sticky lg:top-4"
        aria-label="Resumen de la sesión"
      >
        <div className="card flex flex-col gap-4 p-5">
          <div className="flex flex-col gap-0.5">
            <p className="text-2xs font-bold uppercase tracking-wide text-ink-3">Horario</p>
            <p className="text-base font-bold text-ink">
              {formatDay(selectedSchedule.diaSemana)} {selectedSchedule.horaInicio} —{" "}
              {selectedSchedule.horaFin}
            </p>
            {selectedSchedule.categoriaLabel && (
              <p className="text-sm text-ink-2">{selectedSchedule.categoriaLabel}</p>
            )}
            {sessionDate && <p className="text-xs font-semibold text-ink-2">{formatSessionDateLabel(sessionDate)}</p>}
          </div>

          <div className="flex items-center gap-4 border-t border-line pt-4">
            <SessionDonut counts={confirmCounts} total={totalStudents} className="flex-none" />
            <SessionCompositionCounts
              counts={confirmCounts}
              total={totalStudents}
              className="flex-col !gap-y-1.5"
              hideZero
            />
          </div>

          {unreviewedCount > 0 && (
            <Badge tone="warn" className="self-start">
              {unreviewedCount} sin revisar
            </Badge>
          )}

          <p className="text-xs text-ink-3">
            Se registrará la asistencia de {totalStudents}{" "}
            {totalStudents === 1 ? "jugador" : "jugadores"}.
          </p>

          {submitError && (
            <div className="alert-error" role="alert">
              {submitError}
            </div>
          )}

          <div className="border-t border-line pt-4 max-lg:border-0 max-lg:pt-0">{commitBar}</div>
        </div>
      </aside>
    </div>
  );
}
