import { AlertTriangle, UserCheck } from "lucide-react";
import { ICON } from "@/lib/icon-size";
import { Badge, Button } from "@/components/ui";
import { formatDay } from "@/app/attendance/attendance-utils";
import type { TrainingSchedule } from "@/app/attendance/attendance-utils";
import { SessionCompositionBar, SessionCompositionCounts } from "@/app/trainer/SessionComposition";
import type { EstadoAsistencia } from "@/types/domain";
import ReadOnlyReasonNotice from "./ReadOnlyReasonNotice";

interface ConfirmationStepProps {
  selectedSchedule: TrainingSchedule | null;
  readOnly: boolean;
  confirmCounts: Record<EstadoAsistencia, number>;
  totalStudents: number;
  unreviewedCount: number;
  onReviewUnreviewed: () => void;
  onMarkRemainingPresent: () => void;
  submitError: string | null;
}

/** Step 3: review before filing. See `TrainerAttendancePage`'s own notes on this step. */
export default function ConfirmationStep({
  selectedSchedule,
  readOnly,
  confirmCounts,
  totalStudents,
  unreviewedCount,
  onReviewUnreviewed,
  onMarkRemainingPresent,
  submitError,
}: ConfirmationStepProps): React.ReactElement | null {
  if (!selectedSchedule) return null;

  return (
    <div className="flex flex-col gap-4">
      {/* Defense in depth (issue #310/#3): the commit bar already disables
          "Revisar y confirmar" for a read-only session, so this step should
          not be reachable except through a direct `?paso=confirmar` link. */}
      {readOnly && <ReadOnlyReasonNotice />}
      <dl className="overflow-hidden rounded-ctl border border-line">
        <div className="flex h-drow items-center gap-4 border-b border-line px-5">
          <dt className="w-[160px] flex-none text-2xs font-bold uppercase text-ink-3">Horario</dt>
          <dd className="flex-1 text-sm font-semibold text-ink">
            {formatDay(selectedSchedule.diaSemana)} {selectedSchedule.horaInicio} —{" "}
            {selectedSchedule.horaFin}
          </dd>
        </div>
        <div className="flex min-h-drow items-center gap-4 px-5 py-3">
          <dt className="w-[160px] flex-none text-2xs font-bold uppercase text-ink-3">Resultado</dt>
          <dd className="flex flex-1 flex-col gap-2">
            {/* The same figure the receipt will archive this session as —
                see `SessionComposition`. */}
            <SessionCompositionBar counts={confirmCounts} total={totalStudents} className="max-w-md" />
            <SessionCompositionCounts counts={confirmCounts} total={totalStudents} />
            {unreviewedCount > 0 && (
              <Badge tone="warn" className="self-start">
                {unreviewedCount} sin revisar
              </Badge>
            )}
          </dd>
        </div>
      </dl>

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
                ? `1 de ${totalStudents} alumnos sigue en "Presente" porque nadie lo revisó.`
                : `${unreviewedCount} de ${totalStudents} alumnos siguen en "Presente" porque nadie los revisó.`}
            </span>
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={onReviewUnreviewed}>
              {unreviewedCount === 1 ? "Revisar a ese alumno" : `Revisar a esos ${unreviewedCount}`}
            </Button>
            <Button type="button" variant="tertiary" onClick={onMarkRemainingPresent}>
              <UserCheck size={ICON.sm} strokeWidth={2} aria-hidden="true" />
              Confirmar que están presentes
            </Button>
          </div>
        </div>
      )}

      <p className="text-xs text-ink-3">
        Se registrará la asistencia de {totalStudents} {totalStudents === 1 ? "estudiante" : "estudiantes"}.
      </p>

      {submitError && (
        <div className="alert-error" role="alert">
          {submitError}
        </div>
      )}
    </div>
  );
}
